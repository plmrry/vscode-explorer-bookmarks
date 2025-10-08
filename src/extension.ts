import * as vscode from 'vscode';
import { BookmarksProvider } from './bookmarksProvider';

export function activate(context: vscode.ExtensionContext) {
	console.log('Explorer Bookmarks extension is now active!');

	// Create the bookmarks tree data provider
	const bookmarksProvider = new BookmarksProvider();
	
	// Register the tree data provider
	const treeView = vscode.window.createTreeView('explorerBookmarks', {
		treeDataProvider: bookmarksProvider,
		showCollapseAll: true
	});

	// Register the refresh command
	const refreshCommand = vscode.commands.registerCommand('explorerBookmarks.refresh', () => {
		bookmarksProvider.refresh();
	});

	context.subscriptions.push(treeView);
	context.subscriptions.push(refreshCommand);
}

export function deactivate() {}



