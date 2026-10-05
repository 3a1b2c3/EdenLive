// Three.js 0.161.0.
import { Vector3 } from 'three';

// Visibility graph around expanded, yaw-oriented obstacle footprints. Expanding
// by the actor radius reserves clearance for the whole body, not just its centre.
export class PlanarObstacleNavigator {
  constructor(colliders, radius, height) {
    this.obstacles = colliders.filter(c => {
      const b = c.bounds.clone().applyMatrix4(c.matrix);
      return b.min.y < height && b.max.y > 0;
    });
    this.radius = radius;
    this.nodes = [];
    for (const c of this.obstacles) {
      const b = c.bounds, pad = radius + 0.06;
      for (const x of [b.min.x - pad, b.max.x + pad]) {
        for (const z of [b.min.z - pad, b.max.z + pad]) {
          const p = new Vector3(x, 0, z).applyMatrix4(c.matrix); p.y = 0;
          if (this.clearSegment(p, p)) this.nodes.push(p);
        }
      }
    }
    this.edges = this.nodes.map(() => []);
    this.nodes.forEach((a, i) => {
      for (let j = 0; j < i; j++) {
        if (!this.clearSegment(a, this.nodes[j])) continue;
        const cost = a.distanceTo(this.nodes[j]);
        this.edges[i].push([j, cost]); this.edges[j].push([i, cost]);
      }
    });
  }

  clearSegment(from, to, radius = this.radius) {
    return this.obstacles.every(c => {
      const a = from.clone().applyMatrix4(c.inverse);
      const b = to.clone().applyMatrix4(c.inverse);
      let enter = 0, exit = 1;
      for (const axis of ['x', 'z']) {
        const min = c.bounds.min[axis] - radius, max = c.bounds.max[axis] + radius;
        const d = b[axis] - a[axis];
        if (Math.abs(d) < 1e-9) {
          if (a[axis] < min || a[axis] > max) return true;
        } else {
          const t1 = (min - a[axis]) / d, t2 = (max - a[axis]) / d;
          enter = Math.max(enter, Math.min(t1, t2));
          exit = Math.min(exit, Math.max(t1, t2));
          if (enter > exit) return true;
        }
      }
      return false;
    });
  }

  findPath(start, target, stopDistance = 1.6) {
    const from = start.clone(); from.y = 0;
    const centre = target.clone(); centre.y = 0;
    if (from.distanceTo(centre) <= stopDistance && this.clearSegment(from, centre, 0)) return [];
    // The player can stand closer to a wall than the wider enemy. Find a
    // reachable attack position instead of trying to occupy the player's feet.
    const goals = [centre];
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8;
      goals.push(centre.clone().add(new Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(stopDistance)));
    }
    const reachable = goals.filter(p => this.clearSegment(p, p) && this.clearSegment(p, centre, 0));
    if (!reachable.length) return [];
    const nodes = [...this.nodes, from, ...reachable];
    const startIndex = this.nodes.length;
    const edges = this.edges.map(e => e.slice());
    for (let i = startIndex; i < nodes.length; i++) {
      edges[i] = [];
      for (let j = 0; j < i; j++) {
        if (!this.clearSegment(nodes[i], nodes[j])) continue;
        const cost = nodes[i].distanceTo(nodes[j]);
        edges[i].push([j, cost]); edges[j].push([i, cost]);
      }
    }
    const distance = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set();
    distance[startIndex] = 0;
    while (true) {
      let current = -1;
      for (let i = 0; i < nodes.length; i++) {
        if (!visited.has(i) && distance[i] < (current < 0 ? Infinity : distance[current])) current = i;
      }
      if (current < 0) return [];
      if (current > startIndex) {
        const path = [];
        for (let i = current; i !== startIndex; i = previous[i]) path.unshift(nodes[i].clone());
        return path;
      }
      visited.add(current);
      for (const [next, cost] of edges[current]) {
        if (distance[current] + cost < distance[next]) {
          distance[next] = distance[current] + cost; previous[next] = current;
        }
      }
    }
  }
}
