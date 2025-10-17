import * as vscode from "vscode";
import { BookmarksProvider, BookmarkItem } from "./bookmarksProvider";

export function activate(context: vscode.ExtensionContext) {
  console.log("Explorer Bookmarks extension is now active!");

  // Create the bookmarks tree data provider
  const bookmarksProvider = new BookmarksProvider(context);

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

  context.subscriptions.push(treeView);
  context.subscriptions.push(bookmarksProvider);
}

export function deactivate() {}
