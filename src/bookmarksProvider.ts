import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class BookmarksProvider implements vscode.TreeDataProvider<BookmarkItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<BookmarkItem | undefined | null | void> = new vscode.EventEmitter<BookmarkItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<BookmarkItem | undefined | null | void> = this._onDidChangeTreeData.event;

	private bookmarks: string[] = [];
	private context: vscode.ExtensionContext;
	private bookmarksFilePath: string | null = null;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.initializeBookmarksFile();
		this.loadBookmarks();
	}

	private initializeBookmarksFile(): void {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			const workspaceRoot = workspaceFolders[0].uri.fsPath;
			const vscodeDir = path.join(workspaceRoot, '.vscode');
			
			// Create .vscode directory if it doesn't exist
			if (!fs.existsSync(vscodeDir)) {
				fs.mkdirSync(vscodeDir, { recursive: true });
			}
			
			this.bookmarksFilePath = path.join(vscodeDir, '.bookmarks.json');
		}
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
		return this.bookmarks.map(bookmarkPath => {
			const uri = vscode.Uri.file(bookmarkPath);
			return new BookmarkItem(uri, this.context);
		});
	}

	async addBookmark(uri: vscode.Uri): Promise<void> {
		const filePath = uri.fsPath;
		if (!this.bookmarks.includes(filePath)) {
			this.bookmarks.push(filePath);
			await this.saveBookmarks();
			this.refresh();
		}
	}

	async removeBookmark(item: BookmarkItem): Promise<void> {
		const filePath = item.resourceUri.fsPath;
		this.bookmarks = this.bookmarks.filter(b => b !== filePath);
		await this.saveBookmarks();
		this.refresh();
	}

	private async loadBookmarks(): Promise<void> {
		if (!this.bookmarksFilePath) {
			this.bookmarks = [];
			return;
		}

		try {
			if (fs.existsSync(this.bookmarksFilePath)) {
				const fileContent = fs.readFileSync(this.bookmarksFilePath, 'utf-8');
				const data = JSON.parse(fileContent);
				this.bookmarks = data.bookmarks || [];
			} else {
				this.bookmarks = [];
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to load bookmarks: ${error}`);
			this.bookmarks = [];
		}
	}

	private async saveBookmarks(): Promise<void> {
		if (!this.bookmarksFilePath) {
			vscode.window.showWarningMessage('No workspace folder open. Cannot save bookmarks.');
			return;
		}

		try {
			const data = {
				bookmarks: this.bookmarks
			};
			fs.writeFileSync(this.bookmarksFilePath, JSON.stringify(data, null, 2), 'utf-8');
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to save bookmarks: ${error}`);
		}
	}
}

export class BookmarkItem extends vscode.TreeItem {
	constructor(
		public readonly resourceUri: vscode.Uri,
		private context: vscode.ExtensionContext
	) {
		const label = path.basename(resourceUri.fsPath);
		super(label, vscode.TreeItemCollapsibleState.None);
		
		this.resourceUri = resourceUri;
		this.tooltip = resourceUri.fsPath;
		this.contextValue = 'bookmark';
		
		// Set command to open the file/folder when clicked
		this.command = {
			command: 'explorerBookmarks.openBookmark',
			title: 'Bookmarks: Open Bookmark',
			arguments: [resourceUri]
		};

		// Use appropriate icon based on file/folder
		try {
			const stat = require('fs').statSync(resourceUri.fsPath);
			if (stat.isDirectory()) {
				this.iconPath = new vscode.ThemeIcon('folder');
			} else {
				this.iconPath = vscode.ThemeIcon.File;
			}
		} catch {
			this.iconPath = new vscode.ThemeIcon('bookmark');
		}
	}
}



