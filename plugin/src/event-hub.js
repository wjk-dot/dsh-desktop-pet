/**
 * Lifecycle-owned projection of native Harness session events.
 * Keeps a small replay window so a companion can reconnect without polling.
 */
export class PetEventHub {
  constructor(limit = 256) {
    this.limit = limit
    this.sequence = 0
    this.events = []
    this.listeners = new Set()
  }

  publish(type, data) {
    const event = { seq: ++this.sequence, type, data, time: new Date().toISOString() }
    this.events.push(event)
    if (this.events.length > this.limit) this.events.shift()
    for (const listener of this.listeners) listener(event)
    return event
  }

  replay(after = 0) {
    return this.events.filter((event) => event.seq > after)
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose() {
    this.listeners.clear()
    this.events.length = 0
  }
}
