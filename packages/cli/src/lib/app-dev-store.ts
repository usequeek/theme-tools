import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiFailureOf, type DeveloperApi, type DevStore } from './app-api.js';

/**
 * Which dev store `queek app dev` (and `app dev clean`) works on.
 *
 * Order: `--create-dev-store` always makes a NEW store (even when others
 * exist); `--store` names one (p_id, slug or name); with none, the store
 * picked on an earlier run is reused while it still exists; otherwise a
 * single owned store is taken, several are asked about on a terminal and
 * refused with the exact flag in CI, and no store at all offers to create
 * one. Prompts and output are injected, so every path is testable without
 * a terminal or the API.
 */

export class DevStoreError extends Error {
  constructor(
    message: string,
    readonly exit: number,
  ) {
    super(message);
  }
}

/** A dev store that was just created: the one payload that carries its storefront password. */
export type CreatedDevStore = DevStore & { storefront_password?: string };

export interface DevStorePrompts {
  /** No dev store yet: create one with this name? */
  confirmCreate: (name: string) => Promise<boolean>;
  /** Several dev stores: the chosen store's p_id, or `'new'` to create one. */
  choose: (stores: DevStore[]) => Promise<number | 'new'>;
  /** The name for a store created from the choice menu. */
  askName: (initial: string) => Promise<string>;
}

export interface DevStoreRequest {
  appName: string;
  /** `--store`: a p_id, slug or name. */
  wanted?: string;
  /** `--create-dev-store`. */
  create: boolean;
  storeName?: string;
  storeSlug?: string;
  /** The p_id picked on an earlier run, if `.queek/dev.json` holds one. */
  saved?: number | null;
  /** A terminal is attached: prompts are allowed. */
  interactive: boolean;
}

export interface DevStoreSelection {
  store: DevStore;
  created: boolean;
}

export function formatDevStores(stores: DevStore[]): string {
  return stores.map((store) => `${store.p_id} (${store.name})`).join(', ');
}

/** A --store that names no dev store never reads as "not found", it reads as "wrong kind of store". */
export function devStoreRefusal(wanted: string, stores: DevStore[]): string {
  return `Could not find dev store '${wanted}'. Yours: ${formatDevStores(stores)}. Ensure the store is a dev store (dashboard → Developers → Dev stores) — merchant and test stores cannot run \`queek app dev\`.`;
}

/** First-run default dev-store name: "<app name> dev"; the API derives the slug unless one is given. */
export function defaultDevStoreName(appName: string): string {
  return `${appName} dev`;
}

export function findDevStore(stores: DevStore[], wanted: string): DevStore | undefined {
  return stores.find((store) => String(store.p_id) === wanted || store.name === wanted || store.slug === wanted);
}

/**
 * Create a dev store with test data through the developer dev-stores API.
 * The storefront password is shown HERE, once, clearly labelled (the API
 * will not resend it with the creation payload), and is stripped from the
 * returned store so nothing downstream can print it again. A refusal
 * (plan or limit, taken slug) reads as the server's own sentence plus the
 * way out.
 */
export async function createNewDevStore(
  api: Pick<DeveloperApi, 'createDevStore'>,
  name: string,
  slug: string | undefined,
  log: (line: string) => void,
): Promise<DevStore> {
  let created: CreatedDevStore;
  try {
    created = await api.createDevStore(name, true, randomUUID(), slug);
  } catch (error) {
    const failure = apiFailureOf(error);
    const reason = failure?.message ?? (error as Error).message;
    if (failure?.errorType === 'dev_store_limit_reached' || failure?.status === 402 || failure?.status === 403) {
      throw new DevStoreError(
        `Could not create a dev store: ${reason}. Delete one you no longer need (dashboard → Developers → Dev stores), or pass --store to use one you already have.`,
        1,
      );
    }
    if (failure?.errorType === 'slug_taken') {
      throw new DevStoreError(`Could not create a dev store: ${reason} Pass it with --dev-store-address, or choose another address.`, 2);
    }
    throw new DevStoreError(reason, 1);
  }
  const { storefront_password: password, ...store } = created;
  log(`Created dev store '${store.name}' (${store.p_id}) with test data.`);
  if (typeof password === 'string' && password !== '') {
    log(`Storefront password — shown only now, save it: ${password}`);
  }
  return store;
}

export async function selectDevStore(
  api: Pick<DeveloperApi, 'devStores' | 'createDevStore'>,
  request: DevStoreRequest,
  prompts: DevStorePrompts,
  log: (line: string) => void,
): Promise<DevStoreSelection> {
  if (request.create && request.wanted) {
    throw new DevStoreError('--create-dev-store makes a new dev store and --store picks an existing one — pass only one of them.', 2);
  }
  const { data: stores } = await api.devStores().catch((error: Error) => {
    throw new DevStoreError(error.message, 1);
  });
  const name = request.storeName ?? defaultDevStoreName(request.appName);
  const make = async (chosenName: string): Promise<DevStoreSelection> => ({
    store: await createNewDevStore(api, chosenName, request.storeSlug, log),
    created: true,
  });

  if (request.create) return make(name);

  if (request.wanted) {
    const found = findDevStore(stores, request.wanted);
    if (!found) throw new DevStoreError(devStoreRefusal(request.wanted, stores), 2);
    return { store: found, created: false };
  }

  if (stores.length === 0) {
    if (request.interactive && (await prompts.confirmCreate(name))) return make(name);
    throw new DevStoreError(
      'No dev stores — create one on the dashboard (Developers → Dev stores), or pass --create-dev-store to make one named after this app with test data.',
      2,
    );
  }

  const remembered = request.saved == null ? undefined : stores.find((store) => store.p_id === request.saved);
  if (remembered) return { store: remembered, created: false };

  const only = stores.length === 1 ? stores[0] : undefined;
  if (only) return { store: only, created: false };

  if (!request.interactive) {
    throw new DevStoreError(
      `You own ${stores.length} dev stores — pass --store <p_id|slug|name> (for example --store ${stores[0]?.p_id}), or --create-dev-store to make a new one. Yours: ${formatDevStores(stores)}.`,
      2,
    );
  }
  const choice = await prompts.choose(stores);
  if (choice === 'new') return make(await prompts.askName(name));
  const picked = stores.find((store) => store.p_id === choice);
  if (!picked) throw new DevStoreError(`Dev store ${choice} is not one of yours. Yours: ${formatDevStores(stores)}.`, 2);
  return { store: picked, created: false };
}

const SELECTION_FILE = 'dev.json';

/** The store picked on an earlier run (`.queek/dev.json`), or null. Never throws: a bad file reads as none. */
export function readSavedStore(queek: string): number | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(queek, SELECTION_FILE), 'utf8'));
    const value = (parsed as { store?: unknown } | null)?.store;
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveStore(queek: string, pId: number): void {
  mkdirSync(queek, { recursive: true });
  writeFileSync(join(queek, SELECTION_FILE), `${JSON.stringify({ store: pId })}\n`);
}

/** Forget the saved store; true when there was one. */
export function forgetSavedStore(queek: string): boolean {
  const file = join(queek, SELECTION_FILE);
  if (!existsSync(file)) return false;
  rmSync(file, { force: true });
  return true;
}
