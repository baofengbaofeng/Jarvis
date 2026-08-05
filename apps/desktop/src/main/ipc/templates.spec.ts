import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../db/migrations';
import { createTemplatesStore } from './templates';

describe('templates store', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('creates, lists, updates and removes templates', () => {
    const store = createTemplatesStore(db);
    const t = store.create({ name: 'review', content: 'Review {{name}}' });
    expect(t.id).toBeTruthy();
    expect(store.list()).toEqual([{ id: t.id, name: 'review', content: 'Review {{name}}' }]);

    store.update(t.id, { content: 'Review {{name}} carefully' });
    expect(store.list()[0].content).toBe('Review {{name}} carefully');

    store.remove(t.id);
    expect(store.list()).toEqual([]);
  });

  it('create returns the exact row written even within the same millisecond', () => {
    const store = createTemplatesStore(db);
    const a = store.create({ name: 'a', content: 'A {{x}}' });
    const b = store.create({ name: 'b', content: 'B {{x}}' });
    // If create() returned list().at(-1) after ORDER BY created_at, two rows
    // written in the same millisecond would tie and could resolve to the wrong
    // one; the store returns the row it just wrote instead.
    expect(a.name).toBe('a');
    expect(b.name).toBe('b');
  });

  it('update throws when the template does not exist', () => {
    const store = createTemplatesStore(db);
    expect(() => store.update('nope', { name: 'x' })).toThrow('template nope not found');
  });
});
