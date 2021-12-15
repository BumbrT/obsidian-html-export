
/*
 * main.ts
 *
 * Initialises the plugin, adds command palette options, adds the settings UI
 * Markdown processing is done in renderer.ts and Pandoc invocation in pandoc.ts
 *
 */

import * as fs from 'fs';
import * as path from 'path';

import { Notice, Plugin, FileSystemAdapter, MarkdownView, TFile } from 'obsidian';
import { lookpath } from 'lookpath';
import { pandoc, inputExtensions, outputFormats, OutputFormat, needsLaTeX, needsPandoc } from './pandoc';
import * as YAML from 'yaml';
import * as temp from 'temp';
import rederObject from './renderer';

import PandocPluginSettingTab from './settings';
import { PandocPluginSettings, DEFAULT_SETTINGS, replaceFileExtension } from './global';

const {render, renderDiv } = rederObject;
export default class PandocPlugin extends Plugin {
    settings: PandocPluginSettings;
    features: { [key: string]: string | undefined } = {};

    async onload() {
        console.log('Loading Pandoc plugin');
        await this.loadSettings();

        // Check if Pandoc, LaTeX, etc. are installed and in the PATH
        this.createBinaryMap();

        // Register all of the command palette entries
        this.registerCommands();

        this.addSettingTab(new PandocPluginSettingTab(this.app, this));
    }

    registerCommands() {
        // register Export all command
        this.addCommand({
            id: 'html-exportall', name: 'Export all as html',
            checkCallback: (checking: boolean) => {
                if (!this.app.workspace.activeLeaf) return false;
                const files = this.app.vault.getMarkdownFiles();
                if (!checking) {
                    const exportJobs: (() => Promise<any>)[] = []
                    for (const file of files) {
                        const adapter = this.app.vault.adapter as FileSystemAdapter;
                        const fullPath = adapter.getFullPath(file.path);
                        const job = async () => {
                            await this.startHtmlExport(file, fullPath, 'html');
                        }
                        exportJobs.push(job)
                        console.log(`added job to export ${fullPath}`)
                    }
                    console.log(`total number of jobs: ${exportJobs.length}`)
                    const executeJobs = async () => {
                        for (const job of exportJobs) {
                            await job()
                        }
                    }
                    executeJobs()
                }

                return true;
            }
        });
        this.addCommand({
            id: 'map-exportall', name: 'Export all as mind map',
            checkCallback: (checking: boolean) => {
                if (!this.app.workspace.activeLeaf) return false;
                const adapter = this.app.vault.adapter as FileSystemAdapter;
                const fileName = "map.html"
                let outputFile : string
                if (this.settings.outputFolder) {
                    outputFile = `${this.settings.outputFolder}\\${fileName}`;
                } else {
                    outputFile = `adapter.getBasePath()\\${fileName}`;
                }
                const mapHeader = `<!doctype html>\n` +
                `<html>\n` +
                `    <head>\n` +
                // TODO - add vault name here
                `        <title>Map export</title>\n` +
                `        <meta charset='utf-8'/>\n` +
                `        <style>\n</style>\n` +
                `    </head>\n` +
                `    <body>\n`;
                const footer = `</body>\n</html>`

                fs.promises.writeFile(outputFile, mapHeader);
                const files = this.app.vault.getMarkdownFiles();
                if (!checking) {
                    const exportJobs: (() => Promise<any>)[] = []
                    for (const file of files) {
                        const adapter = this.app.vault.adapter as FileSystemAdapter;
                        const fullPath = adapter.getFullPath(file.path);
                        const job = async () => {
                            await this.startMapExport(file, fullPath, outputFile);
                        }
                        exportJobs.push(job)
                        console.log(`added job to export ${fullPath}`)
                    }
                    console.log(`total number of jobs: ${exportJobs.length}`)
                    const executeJobs = async () => {
                        for (const job of exportJobs) {
                            await job()
                        }
                        await fs.promises.appendFile(outputFile, footer);
                    }
                    executeJobs();
                }

                return true;
            }
        });
    }

    vaultBasePath(): string {
        return (this.app.vault.adapter as FileSystemAdapter).getBasePath();
    }

    getCurrentFile(): string | null {
        const fileData = this.app.workspace.getActiveFile();
        if (!fileData) return null;
        const adapter = this.app.vault.adapter;
        if (adapter instanceof FileSystemAdapter)
            return adapter.getFullPath(fileData.path);
        return null;
    }

    currentFileCanBeExported(format: OutputFormat): boolean {
        // Is it an available output type?
        if (needsPandoc(format) && !this.features['pandoc']) return false;
        if (needsLaTeX(format) && !this.features['pdflatex']) return false;
        // Is it a supported input type?
        const file = this.getCurrentFile();
        if (!file) return false;
        for (const ext of inputExtensions) {
            if (file.endsWith(ext)) return true;
        }
        return false;
    }

    async createBinaryMap() {
        this.features['pandoc'] = this.settings.pandoc || await lookpath('pandoc');
        this.features['pdflatex'] = this.settings.pdflatex || await lookpath('pdflatex');
    }

    async startHtmlExport(file: TFile, inputFile: string, shortName: string) {
        new Notice(`Exporting ${inputFile} to ${shortName}`);
        console.log('exporting: ' + inputFile)
        // Instead of using Pandoc to process the raw Markdown, we use Obsidian's
        // internal markdown renderer, and process the HTML it generates instead.
        // This allows us to more easily deal with Obsidian specific Markdown syntax.
        // However, we provide an option to use MD instead to use citations
        const extension = 'html';
        const format = 'html';
        const htmlContentFolder = "html"
        let outputFile: string = replaceFileExtension(inputFile, extension);
        if (this.settings.outputFolder) {
            outputFile = path.join(`${this.settings.outputFolder}\\${htmlContentFolder}`, path.basename(outputFile));
        } else {
            outputFile = path.join(`${htmlContentFolder}`, path.basename(outputFile));
        }
        await this.app.workspace.activeLeaf.openFile(file);
        // TODO - use renderMarkdown function
        // await new Promise(f => setTimeout(f, 1000));
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);

        try {

            const { html, metadata } = await render(this, view, inputFile, format);

            // Write to HTML file
            await fs.promises.writeFile(outputFile, html);
            console.log('Successfully exported: ' + inputFile)
            new Notice('Successfully exported via Pandoc to ' + outputFile);

        } catch (e) {
            new Notice('Pandoc export failed: ' + e.toString(), 15000);
            console.error(e);
        }
    }

    async startMapExport(obsidianFile: TFile, inputFile: string, outputFile: string) {
        new Notice(`Exporting ${inputFile} to map`);
        console.log('Map exporting: ' + inputFile)
        // Instead of using Pandoc to process the raw Markdown, we use Obsidian's
        // internal markdown renderer, and process the HTML it generates instead.
        // This allows us to more easily deal with Obsidian specific Markdown syntax.
        // However, we provide an option to use MD instead to use citations
        const format = 'html';

        await this.app.workspace.activeLeaf.openFile(obsidianFile);
        // TODO - use renderMarkdown function
        // await new Promise(f => setTimeout(f, 1000));
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);

        try {

            const { html, metadata } = await renderDiv(this, view, inputFile, format);

            // Write to HTML file
            await fs.promises.appendFile(outputFile, html);
            console.log('Successfully Map exported: ' + inputFile)
            new Notice('Successfully exported via Pandoc to ' + outputFile);

        } catch (e) {
            new Notice('Pandoc export failed: ' + e.toString(), 15000);
            console.error(e);
        }
    }

    onunload() {
        console.log('Unloading Pandoc plugin');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
