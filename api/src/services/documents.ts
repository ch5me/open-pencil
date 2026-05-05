import type { Env } from '../env'
import { generateId } from '../db/id'

export class DocumentService {
  constructor(private env: Env) {}

  async create(ownerId: string, title = 'Untitled') {
    const id = generateId()
    const now = Date.now()
    await this.env.DB.prepare(`
      INSERT INTO documents (id, ownerId, title, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, ownerId, title, now, now).run()
    return { id, title, ownerId, createdAt: now, updatedAt: now }
  }

  async getById(id: string) {
    const { results } = await this.env.DB.prepare(
      `SELECT * FROM documents WHERE id = ? AND _deleted = 0`
    ).bind(id).all()
    return results[0] ?? null
  }

  async listByOwner(ownerId: string, limit = 50) {
    const { results } = await this.env.DB.prepare(
      `SELECT * FROM documents WHERE ownerId = ? AND _deleted = 0 ORDER BY updatedAt DESC LIMIT ?`
    ).bind(ownerId, limit).all()
    return results
  }

  async update(id: string, data: { title?: string; description?: string }) {
    const now = Date.now()
    await this.env.DB.prepare(`
      UPDATE documents SET title = COALESCE(?, title), description = COALESCE(?, description), updatedAt = ? WHERE id = ?
    `).bind(data.title, data.description, now, id).run()
  }

  async delete(id: string) {
    const now = Date.now()
    await this.env.DB.prepare(
      `UPDATE documents SET _deleted = 1, updatedAt = ? WHERE id = ?`
    ).bind(now, id).run()
  }

  async saveSnapshot(documentId: string, data: string, createdBy?: string) {
    const snapshotKey = `snapshots/${documentId}/${Date.now()}.json`
    await this.env.DOCUMENTS.put(snapshotKey, data)
    const size = new TextEncoder().encode(data).length
    const id = generateId()
    const now = Date.now()
    await this.env.DB.prepare(`
      INSERT INTO document_snapshots (id, documentId, snapshotKey, size, createdBy, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, documentId, snapshotKey, size, createdBy ?? null, now).run()
    await this.env.DB.prepare(`
      UPDATE documents SET latestSnapshotKey = ?, updatedAt = ? WHERE id = ?
    `).bind(snapshotKey, now, documentId).run()
    return { snapshotKey, snapshotId: id, size }
  }

  async getLatestSnapshot(documentId: string) {
    const { results } = await this.env.DB.prepare(
      `SELECT latestSnapshotKey FROM documents WHERE id = ?`
    ).bind(documentId).all()
    if (!results.length || !results[0].latestSnapshotKey) return null
    const obj = await this.env.DOCUMENTS.get(results[0].latestSnapshotKey as string)
    if (!obj) return null
    return { key: results[0].latestSnapshotKey as string, data: await obj.text() }
  }
}