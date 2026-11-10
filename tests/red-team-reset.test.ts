import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { DemoRepository, DEMO_CONTEXT } from '../services/issuer/src/demo';
import { IssuerStore } from '../services/issuer/src/store';

describe('reset generation and transaction integrity', () => {
  it('preserves a pre-generation legacy disclosure history during migration and reset', () => {
    const db = new DatabaseSync(':memory:');
    const legacy = new IssuerStore(db);
    legacy.provision(DEMO_CONTEXT.scope, DEMO_CONTEXT.principal, 74);
    legacy.request(DEMO_CONTEXT, { threshold: 100, policyEpoch: 1, idempotencyKey: 'legacy-release' });
    const repo = new DemoRepository(db);
    try {
      expect(repo.context).toEqual(DEMO_CONTEXT);
      expect(repo.state().disclosure.candidates).toHaveLength(101);
      repo.reset();
      expect(repo.state().disclosure.candidates).toHaveLength(128);
      expect(repo.context.scope.subject).not.toBe(DEMO_CONTEXT.scope.subject);
      expect(repo.issuer.view(DEMO_CONTEXT).history).toHaveLength(1);
    } finally { repo.close(); }
  });

  it('preserves state/token on actual failed COMMIT and rotates only after a durable reset', () => {
    const db = new DatabaseSync(':memory:'), repo = new DemoRepository(db);
    try {
      repo.issuer.request(repo.context, { threshold: 100, policyEpoch: 1, idempotencyKey: 'before-reset' });
      const beforeContext = repo.context;
      const before = repo.state();
      db.exec(`CREATE TABLE reset_fault_parent(id INTEGER PRIMARY KEY);
        CREATE TABLE reset_fault_child(id INTEGER REFERENCES reset_fault_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER reset_commit_failure AFTER UPDATE ON demo_board BEGIN INSERT INTO reset_fault_child VALUES(123); END;`);
      expect(() => repo.reset()).toThrow();
      expect(repo.state()).toEqual(before);
      expect(db.prepare('SELECT count(*) AS n FROM reset_fault_child').get()?.n).toBe(0);
      db.exec('DROP TRIGGER reset_commit_failure');
      repo.reset();
      const fresh = repo.state();
      expect(fresh.requestToken).not.toBe(before.requestToken);
      expect(fresh.disclosure.candidates).toHaveLength(128);
      expect(fresh.disclosure.history).toEqual([]);
      expect(repo.context.scope.subject).not.toBe(beforeContext.scope.subject);
      expect(repo.context.scope.cohort).not.toBe(beforeContext.scope.cohort);
      expect(repo.issuer.view(beforeContext).history).toHaveLength(1);
      expect(repo.issuer.view(beforeContext).candidates).toHaveLength(101);
      expect(fresh.graph.sequence).toBe(0);
    } finally { repo.close(); }
  });
});
