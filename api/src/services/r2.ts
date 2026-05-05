export class R2Fs {
  constructor(private bucket: R2Bucket) {}

  async put(key: string, data: string | ArrayBuffer | Uint8Array): Promise<void> {
    await this.bucket.put(key, data)
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const obj = await this.bucket.get(key)
    if (!obj) return null
    return await obj.arrayBuffer()
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key)
  }

  async list(prefix: string): Promise<R2Object[]> {
    const listed = await this.bucket.list({ prefix })
    return listed.objects
  }

  async exists(key: string): Promise<boolean> {
    const obj = await this.bucket.head(key)
    return obj !== null
  }
}