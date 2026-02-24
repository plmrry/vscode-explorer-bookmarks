import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

interface BookmarkData {
	path: string;
	icon?: string;
}

const CONFIG_SECTION = "explorerBookmarks";
const BOOKMARKS_SETTING_KEY = "bookmarks";

class BookmarksProvider
	implements
		vscode.TreeDataProvider<BookmarkItem>,
		vscode.TreeDragAndDropController<BookmarkItem>
{
	private _onDidChangeTreeData: vscode.EventEmitter<void> =
		new vscode.EventEmitter<void>();

	readonly onDidChangeTreeData: vscode.Event<void> =
		this._onDidChangeTreeData.event;

	// Drag and drop support
	dropMimeTypes = ["application/vnd.code.tree.explorerBookmarks"];
	dragMimeTypes = ["application/vnd.code.tree.explorerBookmarks"];

	private bookmarks: BookmarkData[] = [];
	private readonly configurationWatcher: vscode.Disposable;

	constructor() {
		this.loadBookmarks();
		this.configurationWatcher = vscode.workspace.onDidChangeConfiguration(
			(event) => {
				if (
					event.affectsConfiguration(
						`${CONFIG_SECTION}.${BOOKMARKS_SETTING_KEY}`,
					)
				) {
					this.refresh();
				}
			},
		);
		void this.migrateBookmarksFileIfNeeded();
	}

	private getLegacyBookmarksFilePath(): string | null {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			const workspaceRoot = workspaceFolders[0].uri.fsPath;
			return path.join(workspaceRoot, ".vscode", ".bookmarks.json");
		}
		return null;
	}

	dispose(): void {
		this.configurationWatcher.dispose();
	}

	refresh(): void {
		this.loadBookmarks();
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: BookmarkItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: BookmarkItem): Thenable<BookmarkItem[]> {
		if (element) {
			// Return children of a specific element if needed
			return Promise.resolve([]);
		} else {
			// Return root level items
			return Promise.resolve(this.getBookmarks());
		}
	}

	private getBookmarks(): BookmarkItem[] {
		return this.bookmarks
			.filter((bookmark) => {
				// Silently filter out files/folders that don't exist
				try {
					return fs.existsSync(bookmark.path);
				} catch {
					return false;
				}
			})
			.map((bookmark) => {
				const uri = vscode.Uri.file(bookmark.path);
				return new BookmarkItem(uri, bookmark.icon);
			});
	}

	async addBookmark(uri: vscode.Uri): Promise<void> {
		const filePath = uri.fsPath;
		if (!this.bookmarks.some((b) => b.path === filePath)) {
			this.bookmarks.push({ path: filePath });
			await this.saveBookmarks();
			this._onDidChangeTreeData.fire();
		}
	}

	async removeBookmark(item: BookmarkItem): Promise<void> {
		const filePath = item.uri.fsPath;
		this.bookmarks = this.bookmarks.filter((b) => b.path !== filePath);
		await this.saveBookmarks();
		this._onDidChangeTreeData.fire();
	}

	async setBookmarkIcon(item: BookmarkItem, icon: string): Promise<void> {
		const filePath = item.uri.fsPath;
		const bookmark = this.bookmarks.find((b) => b.path === filePath);
		if (bookmark) {
			bookmark.icon = icon;
			await this.saveBookmarks();
			this._onDidChangeTreeData.fire();
		}
	}

	private normalizeBookmarks(value: unknown): BookmarkData[] {
		if (!Array.isArray(value)) {
			return [];
		}

		const result: BookmarkData[] = [];
		for (const entry of value) {
			if (!entry || typeof entry !== "object") {
				continue;
			}

			const candidate = entry as { path?: unknown; icon?: unknown };
			if (typeof candidate.path !== "string" || candidate.path.length === 0) {
				continue;
			}

			if (candidate.icon !== undefined && typeof candidate.icon !== "string") {
				continue;
			}

			result.push({
				path: candidate.path,
				icon: typeof candidate.icon === "string" ? candidate.icon : undefined,
			});
		}
		return result;
	}

	private loadBookmarks(): void {
		try {
			const configuredBookmarks = vscode.workspace
				.getConfiguration(CONFIG_SECTION)
				.get<unknown>(BOOKMARKS_SETTING_KEY, []);
			this.bookmarks = this.normalizeBookmarks(configuredBookmarks);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to load bookmarks: ${error}`);
			this.bookmarks = [];
		}
	}

	private async saveBookmarks(): Promise<void> {
		try {
			const hasWorkspaceFolder =
				(vscode.workspace.workspaceFolders?.length ?? 0) > 0;
			const target = hasWorkspaceFolder
				? vscode.ConfigurationTarget.Workspace
				: vscode.ConfigurationTarget.Global;
			await vscode.workspace.getConfiguration(CONFIG_SECTION).update(
				BOOKMARKS_SETTING_KEY,
				this.bookmarks,
				target,
			);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to save bookmarks: ${error}`);
		}
	}

	private async migrateBookmarksFileIfNeeded(): Promise<void> {
		const legacyBookmarksFilePath = this.getLegacyBookmarksFilePath();
		if (!legacyBookmarksFilePath || !fs.existsSync(legacyBookmarksFilePath)) {
			return;
		}

		const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
		const inspectedSetting =
			configuration.inspect<BookmarkData[]>(BOOKMARKS_SETTING_KEY);
		const hasExistingSetting =
			inspectedSetting?.workspaceValue !== undefined ||
			inspectedSetting?.workspaceFolderValue !== undefined ||
			inspectedSetting?.globalValue !== undefined;
		if (hasExistingSetting) {
			return;
		}

		try {
			const fileContent = fs.readFileSync(legacyBookmarksFilePath, "utf-8");
			const data = JSON.parse(fileContent) as { bookmarks?: unknown };
			const migratedBookmarks = this.normalizeBookmarks(data.bookmarks);
			if (migratedBookmarks.length === 0) {
				return;
			}

			this.bookmarks = migratedBookmarks;
			await this.saveBookmarks();
			this._onDidChangeTreeData.fire();
		} catch (error) {
			vscode.window.showWarningMessage(
				`Could not migrate legacy bookmarks file: ${error}`,
			);
		}
	}

	// Drag and drop implementation
	handleDrag(
		source: BookmarkItem[],
		dataTransfer: vscode.DataTransfer,
	): void | Thenable<void> {
		// Serialize the dragged items
		const items = source.map((item) => item.uri.fsPath);
		dataTransfer.set(
			"application/vnd.code.tree.explorerBookmarks",
			new vscode.DataTransferItem(items),
		);
	}

	async handleDrop(
		target: BookmarkItem | undefined,
		dataTransfer: vscode.DataTransfer,
	): Promise<void> {
		// Get the dragged items
		const transferItem = dataTransfer.get(
			"application/vnd.code.tree.explorerBookmarks",
		);
		if (!transferItem) {
			return;
		}

		const draggedPaths = transferItem.value as string[];
		if (!draggedPaths || draggedPaths.length === 0) {
			return;
		}

		// Find the target index
		let targetIndex: number;
		if (target) {
			// Drop on an item - insert after it
			targetIndex =
				this.bookmarks.findIndex((b) => b.path === target.uri.fsPath) + 1;
		} else {
			// Drop on empty space - add to end
			targetIndex = this.bookmarks.length;
		}

		// Remove the dragged items from their current positions
		const draggedBookmarks = this.bookmarks.filter((b) =>
			draggedPaths.includes(b.path),
		);
		this.bookmarks = this.bookmarks.filter(
			(b) => !draggedPaths.includes(b.path),
		);

		// Recalculate target index after removal
		if (target) {
			const newTargetIndex = this.bookmarks.findIndex(
				(b) => b.path === target.uri.fsPath,
			);
			if (newTargetIndex >= 0) {
				targetIndex = newTargetIndex + 1;
			} else {
				targetIndex = this.bookmarks.length;
			}
		} else {
			targetIndex = this.bookmarks.length;
		}

		// Insert the dragged items at the new position
		this.bookmarks.splice(targetIndex, 0, ...draggedBookmarks);

		// Save and refresh
		await this.saveBookmarks();
		this._onDidChangeTreeData.fire();
	}
}

class BookmarkItem extends vscode.TreeItem {
	public readonly uri: vscode.Uri;

	constructor(
		uri: vscode.Uri,
		public readonly icon?: string,
	) {
		const fileName = path.basename(uri.fsPath);

		// Get workspace folder to calculate relative path
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
		let pathSegments = "";

		if (workspaceFolder) {
			const relativePath = path.relative(
				workspaceFolder.uri.fsPath,
				uri.fsPath,
			);
			const parts = relativePath.split(path.sep);

			// Get last two segments (excluding the filename itself)
			if (parts.length > 1) {
				const segments = parts.slice(
					Math.max(0, parts.length - 3),
					parts.length - 1,
				);
				pathSegments = segments.join("/");
			}
		}

		// Create label with filename
		super(fileName, vscode.TreeItemCollapsibleState.None);

		// Add description with path segments in gray
		if (pathSegments) {
			this.description = pathSegments;
		}

		// Store URI as custom property (not resourceUri to avoid icon inference)
		this.uri = uri;
		this.tooltip = uri.fsPath;
		this.contextValue = "bookmark";

		// Set command to open the file/folder when clicked
		this.command = {
			command: "explorerBookmarks.openBookmark",
			title: "Bookmarks: Open Bookmark",
			arguments: [uri],
		};

		// Use custom icon if available, otherwise use file/folder icon
		if (icon) {
			this.iconPath = new vscode.ThemeIcon(icon);
		} else {
			// Determine if path is a directory or file
			// Default to file icon if the path doesn't exist
			try {
				const isDirectory = fs.lstatSync(uri.fsPath).isDirectory();
				this.iconPath = new vscode.ThemeIcon(
					isDirectory ? "symbol-folder" : "symbol-file",
				);
			} catch {
				this.iconPath = new vscode.ThemeIcon("symbol-file");
			}
		}
	}
}

export function activate(context: vscode.ExtensionContext) {
	console.log("Explorer Bookmarks extension is now active!");

	// Create the bookmarks tree data provider
	const bookmarksProvider = new BookmarksProvider();

	// Register the tree data provider
	const treeView = vscode.window.createTreeView("explorerBookmarks", {
		treeDataProvider: bookmarksProvider,
		showCollapseAll: true,
		dragAndDropController: bookmarksProvider,
	});

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand("explorerBookmarks.refresh", () => {
			bookmarksProvider.refresh();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"explorerBookmarks.addBookmark",
			async (uri: vscode.Uri) => {
				if (uri) {
					await bookmarksProvider.addBookmark(uri);
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"explorerBookmarks.removeBookmark",
			async (item: BookmarkItem) => {
				if (item) {
					await bookmarksProvider.removeBookmark(item);
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"explorerBookmarks.openBookmark",
			async (uri: vscode.Uri) => {
				if (uri) {
					try {
						const stat = await vscode.workspace.fs.stat(uri);
						if (stat.type === vscode.FileType.Directory) {
							// Reveal folder in explorer
							await vscode.commands.executeCommand("revealInExplorer", uri);
						} else {
							// Open file
							await vscode.commands.executeCommand("vscode.open", uri);
						}
					} catch (error) {
						vscode.window.showErrorMessage(`Cannot open bookmark: ${error}`);
					}
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"explorerBookmarks.setEmoji",
			async (item: BookmarkItem) => {
				if (item) {
					// Common codicon names
					const icons = [
						"file",
						"folder",
						"home",
						"star",
						"heart",
						"bookmark",
						"flame",
						"lightbulb",
						"rocket",
						"zap",
						"target",
						"bug",
						"beaker",
						"package",
						"gift",
						"trophy",
						"briefcase",
						"graph",
						"note",
						"pencil",
						"tools",
						"gear",
					];

					// Create quick pick items
					const quickPickItems = [
						{ label: "$(close) Remove Icon", icon: "" },
						...icons.map((icon) => ({
							label: `$(${icon}) ${icon}`,
							icon: icon,
						})),
					];

					const selected = await vscode.window.showQuickPick(quickPickItems, {
						placeHolder: "Select an icon for this bookmark",
					});

					if (selected) {
						await bookmarksProvider.setBookmarkIcon(item, selected.icon);
					}
				}
			},
		),
	);

	context.subscriptions.push(treeView);
	context.subscriptions.push(bookmarksProvider);
}
