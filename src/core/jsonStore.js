import fs from 'fs/promises';
import path from 'path';

export class JsonStore {
  constructor(filePath, defaultValue) {
    this.filePath = filePath;
    this.defaultValue = defaultValue;
    this.lock = Promise.resolve();
  }

  async ensure() {
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(
        this.filePath,
        JSON.stringify(this.defaultValue, null, 2),
        'utf8',
      );
    }
  }

  async read() {
    await this.ensure();

    const raw = await fs.readFile(this.filePath, 'utf8');

    try {
      return JSON.parse(raw);
    } catch {
      await this.write(this.defaultValue);
      return this.defaultValue;
    }
  }

  async write(value) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    const tmp = `${this.filePath}.tmp`;

    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
  }

  async update(mutator) {
    this.lock = this.lock.then(async () => {
      const current = await this.read();
      const next = await mutator(current);
      await this.write(next);
      return next;
    });

    return this.lock;
  }
}