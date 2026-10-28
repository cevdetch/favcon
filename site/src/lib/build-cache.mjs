// One completed build, owned by the worker. Transfer/caller mutation never reaches this copy.
export const createBuildCache = (limit = 16 * 1024 * 1024) => {
  let entry;
  return {
    get: (key) => entry?.key === key ? structuredClone(entry.result) : undefined,
    set(key, result) {
      entry = undefined;
      const bytes = result.files.reduce((n, f) => n + f.bytes.byteLength, result.archiveBytes.byteLength);
      if (bytes + key.length * 2 <= limit) entry = { key, result: structuredClone(result) };
    },
  };
};

export const buildKey = (source, o) => JSON.stringify([source, o.colors, o.sizes, o.padding,
  o.bg, [...o.vars].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0), o.animation,
  o.manifest, o.base, o.iterations]);
