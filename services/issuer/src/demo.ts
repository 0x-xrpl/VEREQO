import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applyGraphCommand, createDemoGraph, previewGraphCommand, validateGraph,
  type GraphCommand, type GraphResult } from '../../../packages/consequence/src/index';
import type { DemoState } from '../../../packages/domain/src/demo';
import { IssuerStore, type AuthContext } from './store';

export const DEMO_CONTEXT: AuthContext = {
  principal: 'local-demo-broker', scope: { issuer: 'local-issuer', subject: 'demo-mandate', cohort: 'local-demo' }
};

function contextForGeneration(generation: number): AuthContext {
  const suffix = '-g' + generation;
  return {
    principal: DEMO_CONTEXT.principal,
    scope: {
      ...DEMO_CONTEXT.scope,
      subject: DEMO_CONTEXT.scope.subject + suffix,
      cohort: DEMO_CONTEXT.scope.cohort + suffix
    }
  };
}

/** This fixture is deliberately server-only. It is not real confidential customer data. */
export class DemoRepository {
  // Publicly obtainable, process-local CSRF token. It authenticates no user.
  private csrfToken = randomBytes(24).toString('hex');
  get requestToken(): string { return this.csrfToken; }
  readonly issuer: IssuerStore;
  constructor(private readonly db: DatabaseSync) {
    this.issuer = new IssuerStore(db);
    db.exec("CREATE TABLE IF NOT EXISTS demo_generation(id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL CHECK(generation>=0)); CREATE TABLE IF NOT EXISTS demo_board(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);");
    const savedGeneration = db.prepare('SELECT generation FROM demo_generation WHERE id=1').get();
    if (!savedGeneration) {
      const legacyScope = JSON.stringify([DEMO_CONTEXT.scope.issuer, DEMO_CONTEXT.scope.subject, DEMO_CONTEXT.scope.cohort]);
      const hasLegacyHistory = Boolean(db.prepare('SELECT 1 FROM scopes WHERE id=?').get(legacyScope));
      db.prepare('INSERT OR IGNORE INTO demo_generation VALUES(1,?)').run(hasLegacyHistory ? 0 : 1);
    }
    this.issuer.provision(this.context.scope, this.context.principal, 74);
    db.prepare('INSERT OR IGNORE INTO demo_board VALUES(1,?)').run(JSON.stringify({ snapshot: createDemoGraph(), changes: [] }));
  }

  /** Current local-fixture generation; older scopes remain immutable audit history. */
  get context(): AuthContext {
    const row = this.db.prepare('SELECT generation FROM demo_generation WHERE id=1').get();
    const generation = Number(row?.generation);
    if (!Number.isSafeInteger(generation) || generation < 0) throw new Error('CORRUPT_DEMO_GENERATION');
    return generation === 0 ? DEMO_CONTEXT : contextForGeneration(generation);
  }

  private board(): GraphResult {
    const row = this.db.prepare('SELECT value FROM demo_board WHERE id=1').get();
    if (!row) throw new Error('CORRUPT_GRAPH');
    const value = JSON.parse(String(row.value)) as GraphResult;
    validateGraph(value.snapshot);
    if (!Array.isArray(value.changes)) throw new Error('CORRUPT_GRAPH');
    // Structural checks alone cannot prove complete impacts, epochs or explanations.
    // Recompute every consequence from the known local genesis and stored commands.
    let canonical: GraphResult = { snapshot: createDemoGraph(), changes: [] };
    for (const event of value.snapshot.events) canonical = applyGraphCommand(canonical.snapshot, event.command);
    if (JSON.stringify(canonical.snapshot) !== JSON.stringify(value.snapshot)) throw new Error('CORRUPT_GRAPH');
    return canonical;
  }

  state(): DemoState {
    const disclosure = this.issuer.view(this.context), graph = this.board();
    return { environment: 'LOCAL_REFERENCE', disclosure, graph: graph.snapshot, lastChanges: graph.changes,
      requestToken: this.requestToken,
      capabilities: { proof: 'NOT_IMPLEMENTED', authorization: 'NOT_IMPLEMENTED', execution: 'NOT_IMPLEMENTED' } };
  }

  preview(command: GraphCommand): GraphResult { return previewGraphCommand(this.board().snapshot, command); }

  command(command: GraphCommand): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = applyGraphCommand(this.board().snapshot, command);
      this.db.prepare('UPDATE demo_board SET value=? WHERE id=1').run(JSON.stringify(result));
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  /** Local fixture reset rotates identity to a fresh scope while retaining immutable disclosure history. */
  reset(): void {
    const nextToken = randomBytes(24).toString('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = Number(this.db.prepare('SELECT generation FROM demo_generation WHERE id=1').get()?.generation);
      if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) throw new Error('CORRUPT_DEMO_GENERATION');
      const nextContext = contextForGeneration(current + 1);
      const scope = JSON.stringify([nextContext.scope.issuer, nextContext.scope.subject, nextContext.scope.cohort]);
      const oldWitness = this.db.prepare('SELECT value FROM witnesses WHERE issuer=? AND subject=?')
        .get(nextContext.scope.issuer, nextContext.scope.subject);
      if (oldWitness && Number(oldWitness.value) !== 74) throw new Error('CORRUPT_DEMO_WITNESS');
      if (!oldWitness) this.db.prepare('INSERT INTO witnesses VALUES(?,?,?)').run(nextContext.scope.issuer, nextContext.scope.subject, 74);
      if (this.db.prepare('SELECT 1 FROM scopes WHERE id=?').get(scope)) throw new Error('CORRUPT_DEMO_GENERATION');
      this.db.prepare('INSERT INTO scopes VALUES(?,?,?,?,1)')
        .run(scope, nextContext.scope.issuer, nextContext.scope.subject, nextContext.scope.cohort);
      this.db.prepare('INSERT INTO policies VALUES(?,1,16)').run(scope);
      this.db.prepare('INSERT INTO authorizations VALUES(?,?)').run(nextContext.principal, scope);
      this.db.prepare('UPDATE demo_generation SET generation=? WHERE id=1 AND generation=?').run(current + 1, current);
      this.db.prepare('UPDATE demo_board SET value=? WHERE id=1').run(JSON.stringify({ snapshot: createDemoGraph(), changes: [] }));
      this.db.exec('COMMIT');
      // Reset starts a new local fixture generation; old subject history remains archived.
      this.csrfToken = nextToken;
    } catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* Transaction may already have rolled back. */ } throw e; }
  }

  close(): void { this.issuer.close(); }
}
