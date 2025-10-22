import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export class BookmarksProvider
  implements vscode.TreeDataProvider<BookmarkItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    BookmarkItem | undefined | null | void
  > = new vscode.EventEmitter<BookmarkItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    BookmarkItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private bookmarks: string[] = [];
  private context: vscode.ExtensionContext;
  private bookmarksFilePath: string | null = null;
  private fileWatcher: vscode.FileSystemWatcher | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.initializeBookmarksFile();
    this.loadBookmarks();
    this.setupFileWatcher();
  }

  private initializeBookmarksFile(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const workspaceRoot = workspaceFolders[0].uri.fsPath;
      const vscodeDir = path.join(workspaceRoot, ".vscode");

      // Create .vscode directory if it doesn't exist
      if (!fs.existsSync(vscodeDir)) {
        fs.mkdirSync(vscodeDir, { recursive: true });
      }

      this.bookmarksFilePath = path.join(vscodeDir, ".bookmarks.json");
    }
  }

  private setupFileWatcher(): void {
    if (!this.bookmarksFilePath) {
      return;
    }

    // Create a file system watcher for the bookmarks file
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      this.bookmarksFilePath
    );

    // Watch for changes
    this.fileWatcher.onDidChange(() => {
      console.log("Bookmarks file changed:", this.bookmarksFilePath);
      this.refresh();
    });

    // Watch for creation
    this.fileWatcher.onDidCreate(() => {
      console.log("Bookmarks file created:", this.bookmarksFilePath);
      this.refresh();
    });

    // Watch for deletion
    this.fileWatcher.onDidDelete(() => {
      console.log("Bookmarks file deleted:", this.bookmarksFilePath);
      this.refresh();
    });
  }

  dispose(): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
  }

  async refresh(): Promise<void> {
    await this.loadBookmarks();
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
    return this.bookmarks.map((bookmarkPath) => {
      const uri = vscode.Uri.file(bookmarkPath);
      return new BookmarkItem(uri);
    });
  }

  async addBookmark(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;
    if (!this.bookmarks.includes(filePath)) {
      this.bookmarks.push(filePath);
      await this.saveBookmarks();
    }
  }

  async removeBookmark(item: BookmarkItem): Promise<void> {
    const filePath = item.resourceUri.fsPath;
    this.bookmarks = this.bookmarks.filter((b) => b !== filePath);
    await this.saveBookmarks();
  }

  private async loadBookmarks(): Promise<void> {
    if (!this.bookmarksFilePath) {
      this.bookmarks = [];
      return;
    }

    try {
      if (fs.existsSync(this.bookmarksFilePath)) {
        const fileContent = fs.readFileSync(this.bookmarksFilePath, "utf-8");
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
      vscode.window.showWarningMessage(
        "No workspace folder open. Cannot save bookmarks."
      );
      return;
    }

    try {
      const data = {
        bookmarks: this.bookmarks,
      };
      fs.writeFileSync(
        this.bookmarksFilePath,
        JSON.stringify(data, null, 2),
        "utf-8"
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to save bookmarks: ${error}`);
    }
  }
}

export class BookmarkItem extends vscode.TreeItem {
  constructor(public readonly resourceUri: vscode.Uri) {
    const fileName = path.basename(resourceUri.fsPath);

    // Get workspace folder to calculate relative path
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
    let pathSegments = "";

    if (workspaceFolder) {
      const relativePath = path.relative(
        workspaceFolder.uri.fsPath,
        resourceUri.fsPath
      );
      const parts = relativePath.split(path.sep);

      // Get first two segments (excluding the filename itself)
      if (parts.length > 1) {
        const segments = parts.slice(0, Math.min(2, parts.length - 1));
        pathSegments = segments.join("/");
      }
    }

    // Create label with filename
    super(fileName, vscode.TreeItemCollapsibleState.None);

    // Add description with path segments in gray
    if (pathSegments) {
      this.description = pathSegments;
    }

    this.resourceUri = resourceUri;
    this.tooltip = resourceUri.fsPath;
    this.contextValue = "bookmark";

    // Set command to open the file/folder when clicked
    this.command = {
      command: "explorerBookmarks.openBookmark",
      title: "Bookmarks: Open Bookmark",
      arguments: [resourceUri],
    };

    if (fs.lstatSync(resourceUri.fsPath).isDirectory()) {
      this.iconPath = new vscode.ThemeIcon("symbol-folder");
    } else {
      this.iconPath = vscode.ThemeIcon.File;
    }
  }
}
