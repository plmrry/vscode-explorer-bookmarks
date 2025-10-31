import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

interface BookmarkData {
  path: string;
  icon?: string;
}

class BookmarksProvider implements vscode.TreeDataProvider<BookmarkItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    BookmarkItem | undefined | null | void
  > = new vscode.EventEmitter<BookmarkItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    BookmarkItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private bookmarks: BookmarkData[] = [];
  private bookmarksFilePath: string | null = null;
  private fileWatcher: vscode.FileSystemWatcher | null = null;

  constructor() {
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
    return this.bookmarks.map((bookmark) => {
      const uri = vscode.Uri.file(bookmark.path);
      return new BookmarkItem(uri, bookmark.icon);
    });
  }

  async addBookmark(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;
    if (!this.bookmarks.some((b) => b.path === filePath)) {
      this.bookmarks.push({ path: filePath });
      this.bookmarks.sort((a, b) => {
        const nameA = path.basename(a.path).toLowerCase();
        const nameB = path.basename(b.path).toLowerCase();
        return nameA.localeCompare(nameB);
      });
      await this.saveBookmarks();
    }
  }

  async removeBookmark(item: BookmarkItem): Promise<void> {
    const filePath = item.uri.fsPath;
    this.bookmarks = this.bookmarks.filter((b) => b.path !== filePath);
    await this.saveBookmarks();
  }

  async setBookmarkIcon(item: BookmarkItem, icon: string): Promise<void> {
    const filePath = item.uri.fsPath;
    const bookmark = this.bookmarks.find((b) => b.path === filePath);
    if (bookmark) {
      bookmark.icon = icon;
      await this.saveBookmarks();
    }
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

        this.bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];

        this.bookmarks.sort((a, b) => {
          const nameA = path.basename(a.path).toLowerCase();
          const nameB = path.basename(b.path).toLowerCase();
          return nameA.localeCompare(nameB);
        });
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

class BookmarkItem extends vscode.TreeItem {
  public readonly uri: vscode.Uri;

  constructor(uri: vscode.Uri, public readonly icon?: string) {
    const fileName = path.basename(uri.fsPath);

    // Get workspace folder to calculate relative path
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    let pathSegments = "";

    if (workspaceFolder) {
      const relativePath = path.relative(
        workspaceFolder.uri.fsPath,
        uri.fsPath
      );
      const parts = relativePath.split(path.sep);

      // Get last two segments (excluding the filename itself)
      if (parts.length > 1) {
        const segments = parts.slice(
          Math.max(0, parts.length - 3),
          parts.length - 1
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
      const isDirectory = fs.lstatSync(uri.fsPath).isDirectory();
      this.iconPath = new vscode.ThemeIcon(
        isDirectory ? "symbol-folder" : "symbol-file"
      );
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
  });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("explorerBookmarks.refresh", () => {
      bookmarksProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "explorerBookmarks.addBookmark",
      async (uri: vscode.Uri) => {
        if (uri) {
          await bookmarksProvider.addBookmark(uri);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "explorerBookmarks.removeBookmark",
      async (item: BookmarkItem) => {
        if (item) {
          await bookmarksProvider.removeBookmark(item);
        }
      }
    )
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
      }
    )
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
      }
    )
  );

  context.subscriptions.push(treeView);
  context.subscriptions.push(bookmarksProvider);
}
