import * as vscode from 'vscode';

const PROJECTS_KEY = 'restrainttm.projects';
const STATES_KEY = 'restrainttm.states';

interface ProjectConfig {
	name: string;
	workMinutes: number;
	cooldownMinutes: number;
}

interface ProjectState {
	remainingMs: number;
	lastUpdatedAt: number;
	unblockAt: number | null;
	blockNotified: boolean;
}

interface PersistedStates {
	[projectName: string]: ProjectState;
}

interface WebviewProjectRow {
	name: string;
	workMinutes: number;
	cooldownMinutes: number;
	blocked: boolean;
}

class RestraintController implements vscode.Disposable {
	private readonly statusBar: vscode.StatusBarItem;
	private ticker: NodeJS.Timeout | undefined;
	private configPanel: vscode.WebviewPanel | undefined;
	private blockPanel: vscode.WebviewPanel | undefined;
	private currentProjectName: string | undefined;
	private isDisposed = false;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.statusBar.command = 'restrainttm.openConfig';
		this.context.subscriptions.push(this.statusBar);
	}

	public initialize(): void {
		this.refreshActiveProject();

		this.context.subscriptions.push(
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				this.refreshActiveProject();
			})
		);
	}

	public openConfiguration(): void {
		if (this.configPanel) {
			this.configPanel.reveal(vscode.ViewColumn.Active);
			this.postConfigData();
			return;
		}

		this.configPanel = vscode.window.createWebviewPanel(
			'restrainttm.config',
			'restraintTM Configuracion',
			vscode.ViewColumn.Active,
			{ enableScripts: true }
		);

		this.configPanel.onDidDispose(() => {
			this.configPanel = undefined;
		}, null, this.context.subscriptions);

		this.configPanel.webview.onDidReceiveMessage((message: unknown) => {
			if (!message || typeof message !== 'object') {
				return;
			}

			const payload = message as { type?: string; rows?: unknown };
			if (payload.type === 'requestData') {
				this.postConfigData();
				return;
			}

			if (payload.type === 'save' && Array.isArray(payload.rows)) {
				this.handleSaveRows(payload.rows);
			}
		}, null, this.context.subscriptions);

		this.configPanel.webview.html = this.getConfigWebviewHtml();
		this.postConfigData();
	}

	public dispose(): void {
		this.isDisposed = true;
		this.markCurrentProjectDeparture();
		this.stopTicker();
		this.statusBar.hide();
		this.configPanel?.dispose();
		this.blockPanel?.dispose();
	}

	private refreshActiveProject(): void {
		const previousProjectName = this.currentProjectName;
		const nextProjectName = this.getCurrentWorkspaceFolderName();
		const now = Date.now();

		if (previousProjectName && previousProjectName !== nextProjectName) {
			this.markProjectDeparture(previousProjectName, now);
		}

		this.currentProjectName = nextProjectName;
		const config = this.getCurrentProjectConfig();

		if (!config) {
			this.stopTicker();
			this.hideStatusBar();
			this.hideBlockPanel();
			return;
		}

		this.ensureProjectState(config);
		if (previousProjectName !== config.name) {
			this.applyIdleRecharge(config, now);
		}
		this.startTicker(config);
	}

	private applyIdleRecharge(config: ProjectConfig, now: number): void {
		const state = this.getState(config.name);
		if (!state) {
			return;
		}

		if (state.unblockAt !== null) {
			return;
		}

		const maxWorkMs = this.minutesToMs(config.workMinutes);
		const elapsedMs = Math.max(0, now - state.lastUpdatedAt);
		const rechargeMs = Math.floor(elapsedMs / 2);
		state.remainingMs = Math.min(maxWorkMs, state.remainingMs + rechargeMs);
		state.lastUpdatedAt = now;
		this.persistState(config.name, state);
	}

	private markCurrentProjectDeparture(): void {
		this.markProjectDeparture(this.currentProjectName, Date.now());
	}

	private markProjectDeparture(projectName: string | undefined, now: number): void {
		if (!projectName) {
			return;
		}

		const state = this.getState(projectName);
		if (!state || state.unblockAt !== null) {
			return;
		}

		state.lastUpdatedAt = now;
		this.persistState(projectName, state);
	}

	private startTicker(config: ProjectConfig): void {
		this.stopTicker();
		this.tickProject(config);
		this.ticker = setInterval(() => {
			this.tickProject(config);
		}, 1000);
	}

	private stopTicker(): void {
		if (this.ticker) {
			clearInterval(this.ticker);
			this.ticker = undefined;
		}
	}

	private tickProject(config: ProjectConfig): void {
		const state = this.getState(config.name);
		if (!state) {
			this.ensureProjectState(config);
			return;
		}

		const now = Date.now();

		if (state.unblockAt !== null) {
			if (now >= state.unblockAt) {
				this.resetForNewSession(config, state, now);
				this.hideBlockPanel();
				this.updateActiveStatusBar(state.remainingMs);
				this.persistState(config.name, state);
				return;
			}

			const cooldownLeft = state.unblockAt - now;
			this.updateBlockedStatusBar(cooldownLeft);
			this.showBlockPanel(config.name, cooldownLeft);
			if (!state.blockNotified) {
				state.blockNotified = true;
				vscode.window.showWarningMessage(
					`restraintTM: El proyecto ${config.name} esta bloqueado hasta que termine el cooldown.`,
					{ modal: false }
				);
			}
			this.persistState(config.name, state);
			return;
		}

		const elapsed = now - state.lastUpdatedAt;
		state.lastUpdatedAt = now;
		state.remainingMs = Math.max(0, state.remainingMs - elapsed);

		if (state.remainingMs <= 0) {
			state.remainingMs = 0;
			state.unblockAt = now + this.minutesToMs(config.cooldownMinutes);
			state.blockNotified = false;
			this.persistState(config.name, state);
			this.updateBlockedStatusBar(state.unblockAt - now);
			this.showBlockPanel(config.name, state.unblockAt - now);
			return;
		}

		this.updateActiveStatusBar(state.remainingMs);
		this.hideBlockPanel();
		this.persistState(config.name, state);
	}

	private resetForNewSession(config: ProjectConfig, state: ProjectState, now: number): void {
		state.unblockAt = null;
		state.remainingMs = this.minutesToMs(config.workMinutes);
		state.lastUpdatedAt = now;
		state.blockNotified = false;
	}

	private ensureProjectState(config: ProjectConfig): void {
		const existing = this.getState(config.name);
		if (existing) {
			if (existing.unblockAt !== null && Date.now() >= existing.unblockAt) {
				this.resetForNewSession(config, existing, Date.now());
				this.persistState(config.name, existing);
			}
			return;
		}

		const state: ProjectState = {
			remainingMs: this.minutesToMs(config.workMinutes),
			lastUpdatedAt: Date.now(),
			unblockAt: null,
			blockNotified: false
		};

		this.persistState(config.name, state);
	}

	private handleSaveRows(rawRows: unknown[]): void {
		const parsedRows = this.parseRows(rawRows);
		if (!parsedRows.ok) {
			void vscode.window.showErrorMessage(`restraintTM: ${parsedRows.error}`);
			return;
		}

		const currentConfigs = this.getConfigs();
		const currentStates = this.getAllStates();

		const blockedConfigs = currentConfigs.filter((cfg) => {
			const state = currentStates[cfg.name];
			return Boolean(state && state.unblockAt !== null && state.unblockAt > Date.now());
		});

		for (const blockedConfig of blockedConfigs) {
			const incoming = parsedRows.value.find((row) => row.name === blockedConfig.name);
			if (!incoming) {
				void vscode.window.showErrorMessage(`restraintTM: No puedes borrar ${blockedConfig.name} mientras esta bloqueado.`);
				return;
			}

			if (
				incoming.workMinutes !== blockedConfig.workMinutes ||
				incoming.cooldownMinutes !== blockedConfig.cooldownMinutes
			) {
				void vscode.window.showErrorMessage(`restraintTM: No puedes modificar ${blockedConfig.name} mientras esta bloqueado.`);
				return;
			}
		}

		const incomingByName = new Map(parsedRows.value.map((row) => [row.name, row]));
		const nextStates: PersistedStates = {};

		for (const row of parsedRows.value) {
			const existingState = currentStates[row.name];
			if (existingState) {
				nextStates[row.name] = existingState;
			} else {
				nextStates[row.name] = {
					remainingMs: this.minutesToMs(row.workMinutes),
					lastUpdatedAt: Date.now(),
					unblockAt: null,
					blockNotified: false
				};
			}
		}

		for (const [name, state] of Object.entries(nextStates)) {
			const cfg = incomingByName.get(name);
			if (!cfg) {
				continue;
			}
			const maxWork = this.minutesToMs(cfg.workMinutes);
			if (state.unblockAt === null && state.remainingMs > maxWork) {
				state.remainingMs = maxWork;
			}
		}

		this.saveConfigs(parsedRows.value);
		this.saveAllStates(nextStates);
		this.postConfigData();
		this.refreshActiveProject();
		void vscode.window.showInformationMessage('restraintTM: Configuracion guardada.');
	}

	private parseRows(rawRows: unknown[]): { ok: true; value: ProjectConfig[] } | { ok: false; error: string } {
		const parsed: ProjectConfig[] = [];
		const seen = new Set<string>();

		for (const raw of rawRows) {
			if (!raw || typeof raw !== 'object') {
				return { ok: false, error: 'Fila invalida en configuracion.' };
			}

			const row = raw as { name?: unknown; workMinutes?: unknown; cooldownMinutes?: unknown };
			const name = typeof row.name === 'string' ? row.name.trim() : '';
			const workMinutes = Number(row.workMinutes);
			const cooldownMinutes = Number(row.cooldownMinutes);

			if (!name) {
				return { ok: false, error: 'Cada proyecto debe tener nombre.' };
			}

			if (seen.has(name)) {
				return { ok: false, error: `Nombre repetido: ${name}.` };
			}
			seen.add(name);

			if (!Number.isFinite(workMinutes) || workMinutes <= 0) {
				return { ok: false, error: `Tiempo de trabajo invalido para ${name}.` };
			}

			if (!Number.isFinite(cooldownMinutes) || cooldownMinutes <= 0) {
				return { ok: false, error: `Tiempo de cooldown invalido para ${name}.` };
			}

			parsed.push({
				name,
				workMinutes: Math.round(workMinutes),
				cooldownMinutes: Math.round(cooldownMinutes)
			});
		}

		return { ok: true, value: parsed };
	}

	private postConfigData(): void {
		if (!this.configPanel) {
			return;
		}

		const rows: WebviewProjectRow[] = this.getConfigs().map((cfg) => {
			const state = this.getState(cfg.name);
			const blocked = Boolean(state && state.unblockAt !== null && state.unblockAt > Date.now());
			return {
				name: cfg.name,
				workMinutes: cfg.workMinutes,
				cooldownMinutes: cfg.cooldownMinutes,
				blocked
			};
		});

		void this.configPanel.webview.postMessage({ type: 'data', rows });
	}

	private showBlockPanel(projectName: string, cooldownLeftMs: number): void {
		if (this.isDisposed) {
			return;
		}

		if (!this.blockPanel) {
			this.blockPanel = vscode.window.createWebviewPanel(
				'restrainttm.blocked',
				`restraintTM bloqueado: ${projectName}`,
				vscode.ViewColumn.One,
				{ enableScripts: true, retainContextWhenHidden: true }
			);

			this.blockPanel.onDidDispose(() => {
				this.blockPanel = undefined;
				const config = this.getCurrentProjectConfig();
				if (!config) {
					return;
				}

				const state = this.getState(config.name);
				if (!state || state.unblockAt === null || state.unblockAt <= Date.now()) {
					return;
				}

				setTimeout(() => {
					this.showBlockPanel(config.name, state.unblockAt! - Date.now());
				}, 150);
			}, null, this.context.subscriptions);
		}

		this.blockPanel.title = `restraintTM bloqueado: ${projectName}`;
		this.blockPanel.webview.html = this.getBlockWebviewHtml(projectName, cooldownLeftMs);
		this.blockPanel.reveal(vscode.ViewColumn.One, true);
	}

	private hideBlockPanel(): void {
		if (!this.blockPanel) {
			return;
		}
		this.blockPanel.dispose();
		this.blockPanel = undefined;
	}

	private updateActiveStatusBar(remainingMs: number): void {
		this.statusBar.text = `$(clock) ${this.formatDuration(remainingMs)}`;
		this.statusBar.tooltip = 'restraintTM: tiempo restante del proyecto actual';
		this.statusBar.color = undefined;
		this.statusBar.show();
	}

	private updateBlockedStatusBar(cooldownLeftMs: number): void {
		this.statusBar.text = `$(lock) desbloqueo ${this.formatDuration(cooldownLeftMs)}`;
		this.statusBar.tooltip = 'restraintTM: proyecto bloqueado por cooldown';
		this.statusBar.color = new vscode.ThemeColor('errorForeground');
		this.statusBar.show();
	}

	private hideStatusBar(): void {
		this.statusBar.hide();
	}

	private getCurrentWorkspaceFolderName(): string | undefined {
		const firstFolder = vscode.workspace.workspaceFolders?.[0];
		if (!firstFolder) {
			return undefined;
		}
		return firstFolder.name;
	}

	private getCurrentProjectConfig(): ProjectConfig | undefined {
		if (!this.currentProjectName) {
			return undefined;
		}

		return this.getConfigs().find((config) => config.name === this.currentProjectName);
	}

	private getConfigs(): ProjectConfig[] {
		const raw = this.context.globalState.get<unknown>(PROJECTS_KEY, []);
		if (!Array.isArray(raw)) {
			return [];
		}

		const parsed: ProjectConfig[] = [];
		for (const item of raw) {
			if (!item || typeof item !== 'object') {
				continue;
			}
			const candidate = item as { name?: unknown; workMinutes?: unknown; cooldownMinutes?: unknown };
			if (
				typeof candidate.name === 'string' &&
				Number.isFinite(candidate.workMinutes) &&
				Number.isFinite(candidate.cooldownMinutes)
			) {
				parsed.push({
					name: candidate.name,
					workMinutes: Number(candidate.workMinutes),
					cooldownMinutes: Number(candidate.cooldownMinutes)
				});
			}
		}
		return parsed;
	}

	private saveConfigs(configs: ProjectConfig[]): void {
		void this.context.globalState.update(PROJECTS_KEY, configs);
	}

	private getAllStates(): PersistedStates {
		const raw = this.context.globalState.get<unknown>(STATES_KEY, {});
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			return {};
		}

		const parsed: PersistedStates = {};
		for (const [key, value] of Object.entries(raw)) {
			if (!value || typeof value !== 'object') {
				continue;
			}

			const stateCandidate = value as {
				remainingMs?: unknown;
				lastUpdatedAt?: unknown;
				unblockAt?: unknown;
				blockNotified?: unknown;
			};

			if (!Number.isFinite(stateCandidate.remainingMs) || !Number.isFinite(stateCandidate.lastUpdatedAt)) {
				continue;
			}

			const unblockAtValue = stateCandidate.unblockAt;
			const unblockAt = unblockAtValue === null || Number.isFinite(unblockAtValue)
				? (unblockAtValue as number | null)
				: null;

			parsed[key] = {
				remainingMs: Number(stateCandidate.remainingMs),
				lastUpdatedAt: Number(stateCandidate.lastUpdatedAt),
				unblockAt,
				blockNotified: Boolean(stateCandidate.blockNotified)
			};
		}

		return parsed;
	}

	private saveAllStates(states: PersistedStates): void {
		void this.context.globalState.update(STATES_KEY, states);
	}

	private getState(projectName: string): ProjectState | undefined {
		return this.getAllStates()[projectName];
	}

	private persistState(projectName: string, state: ProjectState): void {
		const states = this.getAllStates();
		states[projectName] = state;
		this.saveAllStates(states);
	}

	private minutesToMs(minutes: number): number {
		return Math.round(minutes * 60 * 1000);
	}

	private formatDuration(ms: number): string {
		const safeMs = Math.max(0, Math.round(ms));
		const totalSeconds = Math.floor(safeMs / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		const hh = String(hours).padStart(2, '0');
		const mm = String(minutes).padStart(2, '0');
		const ss = String(seconds).padStart(2, '0');
		return `${hh}:${mm}:${ss}`;
	}

	private getBlockWebviewHtml(projectName: string, cooldownLeftMs: number): string {
		const timeLeft = this.formatDuration(cooldownLeftMs);
		return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>restraintTM bloqueado</title>
  <style>
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      background: linear-gradient(160deg, #1f1f1f, #2f1f1f);
      color: #f9f1f1;
      min-height: 100vh;
      display: grid;
      place-items: center;
    }
    .card {
      width: min(640px, 92vw);
      border: 1px solid #844;
      border-radius: 14px;
      padding: 28px;
      background: rgba(30, 14, 14, 0.7);
      box-shadow: 0 20px 40px rgba(0,0,0,.35);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 1.8rem;
    }
    p {
      margin: 0 0 10px;
      line-height: 1.45;
    }
    .timer {
      margin-top: 18px;
      font-size: 1.35rem;
      font-weight: 700;
      color: #ffb8b8;
    }
  </style>
</head>
<body>
  <section class="card">
    <h1>Proyecto bloqueado</h1>
    <p>restraintTM ha bloqueado temporalmente <strong>${this.escapeHtml(projectName)}</strong>.</p>
    <p>Toma un descanso y vuelve cuando termine el cooldown.</p>
    <p class="timer">Desbloqueo en ${timeLeft}</p>
  </section>
</body>
</html>`;
	}

	private getConfigWebviewHtml(): string {
		return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>restraintTM Configuracion</title>
  <style>
    :root {
      color-scheme: light dark;
    }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      padding: 20px;
    }
    h1 {
      margin-top: 0;
      font-size: 1.4rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
    }
    th, td {
      border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      padding: 10px 8px;
      text-align: left;
      vertical-align: middle;
    }
    input[type="text"], input[type="number"] {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-top: 14px;
    }
    .state {
      font-size: 0.86rem;
      opacity: 0.9;
    }
    .locked {
      color: #dd6464;
      font-weight: 700;
    }
    button {
      padding: 7px 11px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <h1>restraintTM - Configuracion de proyectos</h1>
  <p>Define que proyectos tienen limite de tiempo de trabajo continuo.</p>

  <table>
    <thead>
      <tr>
        <th>Proyecto</th>
        <th>Trabajo (min)</th>
        <th>Cooldown (min)</th>
        <th>Estado</th>
        <th></th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>

  <div class="actions">
    <button id="add">Anadir fila</button>
    <button id="save">Guardar</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const rowsContainer = document.getElementById('rows');
    const addButton = document.getElementById('add');
    const saveButton = document.getElementById('save');
    let rows = [];

    const render = () => {
      rowsContainer.innerHTML = '';

      rows.forEach((row, index) => {
        const tr = document.createElement('tr');
        const disabled = row.blocked ? 'disabled' : '';
        const statusText = row.blocked
          ? '<span class="state locked">Bloqueado</span>'
          : '<span class="state">Activo</span>';

				tr.innerHTML =
					'<td><input type="text" ' + disabled + ' value="' + escapeHtml(row.name) + '" data-field="name" data-index="' + index + '"></td>' +
					'<td><input type="number" min="1" step="1" ' + disabled + ' value="' + row.workMinutes + '" data-field="workMinutes" data-index="' + index + '"></td>' +
					'<td><input type="number" min="1" step="1" ' + disabled + ' value="' + row.cooldownMinutes + '" data-field="cooldownMinutes" data-index="' + index + '"></td>' +
					'<td>' + statusText + '</td>' +
					'<td><button data-delete="' + index + '" ' + disabled + '>Eliminar</button></td>';

        rowsContainer.appendChild(tr);
      });
    };

    const readRowsFromDom = () => {
      const next = [];
      rowsContainer.querySelectorAll('tr').forEach((tr) => {
        const nameInput = tr.querySelector('input[data-field="name"]');
        const workInput = tr.querySelector('input[data-field="workMinutes"]');
        const cooldownInput = tr.querySelector('input[data-field="cooldownMinutes"]');
        const deleteButton = tr.querySelector('button[data-delete]');
        const index = Number(deleteButton?.getAttribute('data-delete') ?? -1);
        const blocked = rows[index]?.blocked ?? false;
        next.push({
          name: String(nameInput?.value ?? '').trim(),
          workMinutes: Number(workInput?.value ?? 0),
          cooldownMinutes: Number(cooldownInput?.value ?? 0),
          blocked
        });
      });
      return next;
    };

    const escapeHtml = (value) => {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    };

    addButton.addEventListener('click', () => {
      rows = readRowsFromDom();
      rows.push({ name: '', workMinutes: 60, cooldownMinutes: 30, blocked: false });
      render();
    });

    rowsContainer.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) {
        return;
      }
      const index = Number(target.getAttribute('data-delete') ?? -1);
      if (index < 0 || rows[index]?.blocked) {
        return;
      }
      rows = readRowsFromDom();
      rows.splice(index, 1);
      render();
    });

    saveButton.addEventListener('click', () => {
      rows = readRowsFromDom();
      vscode.postMessage({ type: 'save', rows });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.type !== 'data' || !Array.isArray(message.rows)) {
        return;
      }
      rows = message.rows;
      render();
    });

    vscode.postMessage({ type: 'requestData' });
  </script>
</body>
</html>`;
	}

	private escapeHtml(value: string): string {
		return value
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');
	}
}

let controller: RestraintController | undefined;

export function activate(context: vscode.ExtensionContext): void {
	controller = new RestraintController(context);
	controller.initialize();

	context.subscriptions.push(
		vscode.commands.registerCommand('restrainttm.openConfig', () => {
			controller?.openConfiguration();
		})
	);

	context.subscriptions.push(controller);
}

export function deactivate(): void {
	controller?.dispose();
	controller = undefined;
}
