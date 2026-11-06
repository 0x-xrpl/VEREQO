import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applyGraphCommand, createDemoGraph, previewGraphCommand, validateGraph,
  type GraphCommand, type GraphResult } from '../../../packages/consequence/src/index';
import type { DemoState } from '../../../packages/domain/src/demo';
import { IssuerStore, type AuthContext } from './store';

export const DEMO_CONTEXT: AuthContext = {
  principal: 'local-demo-broker', scope: { issuer: 'local-issuer', subject: 'demo-mandate', cohort: 'local-demo' }
};

/** This fixture is deliberately server-only. It is not real confidential customer data. */
export class DemoRepository {
  // Publicly obtainable, process-local CSRF token. It authenticates no user.
  private csrfToken = randomBytes(24).toString('hex');
  get requestToken(): string { return this.csrfToken; }
  readonly issuer: IssuerStore;
  constructor(private readonly db: DatabaseSync) {
    this.issuer = new IssuerStore(db);
    this.issuer.provision(DEMO_CONTEXT.scope, DEMO_CONTEXT.principal, 74);
    db.exec('CREATE TABLE IF NOT EXISTS demo_board(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
    db.prepare('INSERT OR IGNORE INTO demo_board VALUES(1,?)').run(JSON.stringify({ snapshot: createDemoGraph(), changes: [] }));
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
    const disclosure = this.issuer.view(DEMO_CONTEXT), graph = this.board();
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

  /** Local fixture reset only. This capability is not part of the issuer/requester API. */
  reset(): void {
    const nextToken = randomBytes(24).toString('hex');
    const scope = JSON.stringify([DEMO_CONTEXT.scope.issuer, DEMO_CONTEXT.scope.subject, DEMO_CONTEXT.scope.cohort]);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM disclosures WHERE scope_id=?').run(scope);
      this.db.prepare('DELETE FROM policies WHERE scope_id=?').run(scope);
      this.db.prepare('INSERT INTO policies VALUES(?,1,16)').run(scope);
      this.db.prepare('UPDATE scopes SET policy_epoch=1 WHERE id=?').run(scope);
      this.db.prepare('UPDATE demo_board SET value=? WHERE id=1').run(JSON.stringify({ snapshot: createDemoGraph(), changes: [] }));
      this.db.exec('COMMIT');
      // Reset starts a new local fixture generation; delayed old requests fail.
      this.csrfToken = nextToken;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  close(): void { this.issuer.close(); }
}
