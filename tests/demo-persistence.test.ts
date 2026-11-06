import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { DemoRepository } from '../services/issuer/src/demo';
import type { GraphResult } from '../packages/consequence/src/index';

describe('canonical persisted board evidence', () => {
  it.each(['missing-impact', 'forged-reason', 'forged-epoch', 'forged-genesis'])('rejects %s', corruption => {
    const db = new DatabaseSync(':memory:'), repo = new DemoRepository(db);
    try {
      if (corruption !== 'forged-genesis') repo.command({ type: 'REVOKE_CREDENTIAL', nodeId: 'credential_A', eventId: 'revoke', expectedSequence: 0 });
      const stored = JSON.parse(String(db.prepare('SELECT value FROM demo_board').get()!.value)) as GraphResult;
      if (corruption === 'missing-impact') stored.snapshot.events[0]!.changes = stored.snapshot.events[0]!.changes.filter(c => c.nodeId !== 'action_A');
      if (corruption === 'forged-reason') stored.snapshot.events[0]!.changes[0]!.reason = 'fabricated explanation';
      if (corruption === 'forged-epoch') stored.snapshot.nodes.find(n => n.id === 'credential_A')!.epoch = 999;
      if (corruption === 'forged-genesis') stored.snapshot.nodes.find(n => n.id === 'issuer_A')!.label = 'forged issuer';
      db.prepare('UPDATE demo_board SET value=?').run(JSON.stringify(stored));
      expect(() => repo.state()).toThrow();
    } finally { repo.close(); }
  });
  it('derives all displayed changes from replay and ignores redundant presentation values', () => {
    const db = new DatabaseSync(':memory:'), repo = new DemoRepository(db);
    try {
      repo.command({ type: 'REVOKE_CREDENTIAL', nodeId: 'credential_A', eventId: 'revoke', expectedSequence: 0 });
      const before = repo.state();
      const stored = JSON.parse(String(db.prepare('SELECT value FROM demo_board').get()!.value)) as GraphResult;
      stored.changes = []; db.prepare('UPDATE demo_board SET value=?').run(JSON.stringify(stored));
      expect(repo.state().lastChanges).toEqual(before.lastChanges);
    } finally { repo.close(); }
  });
});
