/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAsyncDataSource } from 'vs/base/browser/ui/tree/tree';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { INotebookKernel, INotebookKernelService, VariablesResult, variablePageSize } from 'vs/workbench/contrib/notebook/common/notebookKernelService';

export interface INotebookScope {
	kind: 'root';
	readonly notebook: NotebookTextModel;
}

export interface INotebookVariableElement {
	kind: 'variable';
	readonly id: string;
	readonly extHostId: number;
	readonly name: string;
	readonly value: string;
	readonly type?: string;
	readonly indexedChildrenCount: number;
	readonly indexStart?: number;
	readonly hasNamedChildren: boolean;
	readonly notebook: NotebookTextModel;
}

export class NotebookVariableDataSource implements IAsyncDataSource<INotebookScope, INotebookVariableElement> {

	private cancellationTokenSource: CancellationTokenSource;

	constructor(private readonly notebookKernelService: INotebookKernelService) {
		this.cancellationTokenSource = new CancellationTokenSource();
	}

	hasChildren(element: INotebookScope | INotebookVariableElement): boolean {
		return element.kind === 'root' || element.hasNamedChildren || element.indexedChildrenCount > 0;
	}

	public cancel(): void {
		this.cancellationTokenSource.cancel();
		this.cancellationTokenSource.dispose();
		this.cancellationTokenSource = new CancellationTokenSource();
	}

	async getChildren(element: INotebookScope | INotebookVariableElement): Promise<Array<INotebookVariableElement>> {
		if (element.kind === 'root') {
			return this.getRootVariables(element.notebook);
		} else {
			return this.getVariables(element);
		}
	}

	async getVariables(parent: INotebookVariableElement): Promise<INotebookVariableElement[]> {
		const selectedKernel = this.notebookKernelService.getMatchingKernel(parent.notebook).selected;
		if (selectedKernel && selectedKernel.hasVariableProvider) {

			let children: INotebookVariableElement[] = [];
			if (parent.hasNamedChildren) {
				const variables = selectedKernel.provideVariables(parent.notebook.uri, parent.extHostId, 'named', 0, this.cancellationTokenSource.token);
				const childNodes = await variables
					.map(variable => { return this.createVariableElement(variable, parent.notebook); })
					.toPromise();
				children = children.concat(childNodes);
			}
			if (parent.indexedChildrenCount > 0) {
				const childNodes = await this.getIndexedChildren(parent, selectedKernel);
				children = children.concat(childNodes);
			}

			return children;
		}
		return [];
	}

	async getIndexedChildren(parent: INotebookVariableElement, kernel: INotebookKernel) {
		const childNodes: INotebookVariableElement[] = [];

		if (parent.indexedChildrenCount > variablePageSize) {
			for (let start = 0; start < parent.indexedChildrenCount; start += variablePageSize) {
				let end = start + variablePageSize;
				if (end > parent.indexedChildrenCount) {
					end = parent.indexedChildrenCount;
				}

				childNodes.push({
					kind: 'variable',
					notebook: parent.notebook,
					id: parent.id + `${start}`,
					extHostId: parent.extHostId,
					name: `[${start}..${end - 1}]`,
					value: '',
					indexedChildrenCount: end - start,
					indexStart: start,
					hasNamedChildren: false
				});
			}
		}
		else if (parent.indexedChildrenCount > 0) {
			const variables = kernel.provideVariables(parent.notebook.uri, parent.extHostId, 'indexed', parent.indexStart ?? 0, this.cancellationTokenSource.token);

			for await (const variable of variables) {
				childNodes.push(this.createVariableElement(variable, parent.notebook));
				if (childNodes.length >= variablePageSize) {
					break;
				}
			}

		}
		return childNodes;
	}

	async getRootVariables(notebook: NotebookTextModel): Promise<INotebookVariableElement[]> {
		const selectedKernel = this.notebookKernelService.getMatchingKernel(notebook).selected;
		if (selectedKernel && selectedKernel.hasVariableProvider) {
			const variables = selectedKernel.provideVariables(notebook.uri, undefined, 'named', 0, this.cancellationTokenSource.token);
			return await variables
				.map(variable => { return this.createVariableElement(variable, notebook); })
				.toPromise();
		}

		return [];
	}

	private createVariableElement(variable: VariablesResult, notebook: NotebookTextModel): INotebookVariableElement {
		return {
			...variable,
			kind: 'variable',
			notebook,
			extHostId: variable.id,
			id: `${variable.id}`
		};
	}
}
