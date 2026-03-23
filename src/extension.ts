import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

interface BookmarkData {
  path: string;
  icon?: string;
}

type BookmarkStorage = "workspaceFile" | "preferences";

const BOOKMARKS_FILENAME = "bookmarks.json";
const CONFIG_SECTION = "explorerBookmarks";
const BOOKMARKS_SETTING_KEY = "bookmarks";
const STORAGE_SETTING_KEY = "storage";

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
  private bookmarksFilePath: string | null = null;
  private storage: BookmarkStorage = "workspaceFile";

  constructor() {
    this.storage = this.getStorage();
    this.bookmarksFilePath = this.getBookmarksFilePath();
    this.loadBookmarks();
  }

  dispose(): void {}

  refresh(): void {
    this.loadBookmarks();
    this._onDidChangeTreeData.fire();
  }

  async handleConfigurationChange(
    event: vscode.ConfigurationChangeEvent,
  ): Promise<void> {
    const storageSetting = this.getConfigurationKey(STORAGE_SETTING_KEY);
    const bookmarksSetting = this.getConfigurationKey(BOOKMARKS_SETTING_KEY);

    if (event.affectsConfiguration(storageSetting)) {
      const nextStorage = this.getStorage();
      if (nextStorage !== this.storage) {
        await this.writeBookmarks(nextStorage, this.bookmarks);
        this.storage = nextStorage;
        this.loadBookmarks();
        this._onDidChangeTreeData.fire();
        return;
      }
    }

    if (
      event.affectsConfiguration(bookmarksSetting) &&
      this.getStorage() === "preferences"
    ) {
      this.loadBookmarks();
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(element: BookmarkItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BookmarkItem): Thenable<BookmarkItem[]> {
    if (element) {
      // Return children of a specific element if needed
      return Promise.resolve([]);
    }

    // Return root level items
    return Promise.resolve(
      this.bookmarks
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
        }),
    );
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

  private getBookmarksFilePath(): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return null;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    return path.join(workspaceRoot, ".vscode", BOOKMARKS_FILENAME);
  }

  private normalizeBookmarks(value: unknown): BookmarkData[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const normalizedBookmarks: BookmarkData[] = [];
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

      normalizedBookmarks.push({
        icon: typeof candidate.icon === "string" ? candidate.icon : undefined,
        path: candidate.path,
      });
    }

    return normalizedBookmarks;
  }

  private getStorage(): BookmarkStorage {
    const configuredStorage = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<unknown>(STORAGE_SETTING_KEY, "workspaceFile");

    return configuredStorage === "preferences"
      ? "preferences"
      : "workspaceFile";
  }

  private getConfigurationKey(setting: string): string {
    return `${CONFIG_SECTION}.${setting}`;
  }

  private isStorageConfigured(): boolean {
    const storageInspection = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .inspect<BookmarkStorage>(STORAGE_SETTING_KEY);

    return Boolean(
      storageInspection?.globalValue !== undefined ||
        storageInspection?.workspaceValue !== undefined ||
        storageInspection?.workspaceFolderValue !== undefined ||
        storageInspection?.globalLanguageValue !== undefined ||
        storageInspection?.workspaceLanguageValue !== undefined ||
        storageInspection?.workspaceFolderLanguageValue !== undefined,
    );
  }

  private hasWorkspaceContext(): boolean {
    return Boolean(
      vscode.workspace.workspaceFile ||
        (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
    );
  }

  private loadBookmarksFromPreferences(): BookmarkData[] {
    try {
      const configuredBookmarks = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<unknown>(BOOKMARKS_SETTING_KEY, []);
      return this.normalizeBookmarks(configuredBookmarks);
    } catch {
      return [];
    }
  }

  private loadBookmarksFromWorkspaceFile(): BookmarkData[] {
    try {
      if (!this.bookmarksFilePath) {
        return [];
      }

      if (!fs.existsSync(this.bookmarksFilePath)) {
        if (!this.isStorageConfigured()) {
          const migratedBookmarks = this.loadBookmarksFromPreferences();
          if (migratedBookmarks.length > 0) {
            void this.saveBookmarksToWorkspaceFile(migratedBookmarks);
          }

          return migratedBookmarks;
        }

        return [];
      }

      const fileContent = fs.readFileSync(this.bookmarksFilePath, "utf-8");
      const parsed = JSON.parse(fileContent) as unknown;

      if (Array.isArray(parsed)) {
        return this.normalizeBookmarks(parsed);
      }

      if (parsed && typeof parsed === "object") {
        const bookmarks = (parsed as { bookmarks?: unknown }).bookmarks;
        return this.normalizeBookmarks(bookmarks);
      }

      return [];
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to load bookmarks: ${error}`);
      return [];
    }
  }

  private loadBookmarks(): void {
    this.storage = this.getStorage();
    this.bookmarksFilePath = this.getBookmarksFilePath();

    if (this.storage === "preferences") {
      this.bookmarks = this.loadBookmarksFromPreferences();
      return;
    }

    this.bookmarks = this.loadBookmarksFromWorkspaceFile();
  }

  private async saveBookmarks(): Promise<void> {
    this.storage = this.getStorage();
    await this.writeBookmarks(this.storage, this.bookmarks);
  }

  private async writeBookmarks(
    storage: BookmarkStorage,
    bookmarks: BookmarkData[],
  ): Promise<void> {
    if (storage === "preferences") {
      await this.saveBookmarksToPreferences(bookmarks);
      return;
    }

    await this.saveBookmarksToWorkspaceFile(bookmarks);
  }

  private async saveBookmarksToPreferences(
    bookmarks: BookmarkData[],
  ): Promise<void> {
    if (!this.hasWorkspaceContext()) {
      vscode.window.showWarningMessage(
        "No workspace open. Cannot save bookmarks to workspace preferences.",
      );
      return;
    }

    try {
      await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update(
          BOOKMARKS_SETTING_KEY,
          bookmarks,
          vscode.ConfigurationTarget.Workspace,
        );
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to save bookmarks: ${error}`);
    }
  }

  private async saveBookmarksToWorkspaceFile(
    bookmarks: BookmarkData[],
  ): Promise<void> {
    this.bookmarksFilePath = this.getBookmarksFilePath();
    if (!this.bookmarksFilePath) {
      vscode.window.showWarningMessage(
        "No workspace folder open. Cannot save bookmarks.",
      );
      return;
    }

    try {
      const bookmarksDirectory = path.dirname(this.bookmarksFilePath);
      fs.mkdirSync(bookmarksDirectory, { recursive: true });

      fs.writeFileSync(
        this.bookmarksFilePath,
        JSON.stringify({ bookmarks }, null, 2),
        "utf-8",
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to save bookmarks: ${error}`);
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
      arguments: [uri],
      command: "explorerBookmarks.openBookmark",
      title: "Bookmarks: Open Bookmark",
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
    dragAndDropController: bookmarksProvider,
    showCollapseAll: true,
    treeDataProvider: bookmarksProvider,
  });

  // Register commands
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      void bookmarksProvider.handleConfigurationChange(event);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "explorerBookmarks.refresh",
      bookmarksProvider.refresh,
      bookmarksProvider,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "explorerBookmarks.addBookmark",
      async (uri?: vscode.Uri) => {
        if (!uri) {
          return;
        }

        await bookmarksProvider.addBookmark(uri);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "explorerBookmarks.removeBookmark",
      async (item?: BookmarkItem) => {
        if (!item) {
          return;
        }

        await bookmarksProvider.removeBookmark(item);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "explorerBookmarks.openBookmark",
      async (uri?: vscode.Uri) => {
        if (!uri) {
          return;
        }

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
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "explorerBookmarks.setEmoji",
      async (item?: BookmarkItem) => {
        if (!item) {
          return;
        }

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
          { icon: "", label: "$(close) Remove Icon" },
          ...icons.map((icon) => ({
            icon: icon,
            label: `$(${icon}) ${icon}`,
          })),
        ];

        const selected = await vscode.window.showQuickPick(quickPickItems, {
          placeHolder: "Select an icon for this bookmark",
        });

        if (selected) {
          await bookmarksProvider.setBookmarkIcon(item, selected.icon);
        }
      },
    ),
  );

  context.subscriptions.push(treeView);
  context.subscriptions.push(bookmarksProvider);
}
