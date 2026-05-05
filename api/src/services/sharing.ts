import type { Env } from '../env'
import { generateId } from '../db/id'

export class SharingService {
  constructor(private env: Env) {}

  async createShareLink(documentId: string, role = 'viewer', createdBy?: string) {
    const id = generateId()
    const token = this.generateToken()
    const now = Date.now()
    await this.env.DB.prepare(`
      INSERT INTO share_links (id, documentId, token, role, createdBy, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, documentId, token, role, createdBy ?? null, now).run()
    return { id, token, documentId, role }
  }

  async getShareLink(token: string) {
    const { results } = await this.env.DB.prepare(`
      SELECT sl.*, d.title, d.isPublic FROM share_links sl
      JOIN documents d ON d.id = sl.documentId
      WHERE sl.token = ?
    `).bind(token).all()
    return results[0] ?? null
  }

  async deleteShareLink(token: string): Promise<void> {
    await this.env.DB.prepare(`DELETE FROM share_links WHERE token = ?`).bind(token).run()
  }

  async addMember(documentId: string, userId: string, role: string, invitedBy?: string) {
    const id = generateId()
    const now = Date.now()
    await this.env.DB.prepare(`
      INSERT INTO document_members (id, documentId, userId, role, invitedBy, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, documentId, userId, role, invitedBy ?? null, now, now).run()
    return { id, documentId, userId, role }
  }

  async listMembers(documentId: string) {
    const { results } = await this.env.DB.prepare(`
      SELECT dm.*, u.email, u.name FROM document_members dm
      JOIN users u ON u.id = dm.userId
      WHERE dm.documentId = ? AND dm._deleted = 0
    `).bind(documentId).all()
    return results
  }

  async updateMemberRole(memberId: string, role: string): Promise<void> {
    const now = Date.now()
    await this.env.DB.prepare(`
      UPDATE document_members SET role = ?, updatedAt = ? WHERE id = ?
    `).bind(role, now, memberId).run()
  }

  async removeMember(memberId: string): Promise<void> {
    const now = Date.now()
    await this.env.DB.prepare(
      `UPDATE document_members SET _deleted = 1, updatedAt = ? WHERE id = ?`
    ).bind(now, memberId).run()
  }

  private generateToken(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
  }
}