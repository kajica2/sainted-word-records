// scripts/lib/fake-firestore.mjs — an in-memory stand-in for the
// Firestore Admin client.
//
// It implements the subset of the admin API the SWR stores use:
//   collection(name).doc(id).get() | set(data) | create(data) | delete(pre)
//   collection(name).where(field, op, value).limit(n).get()
//   collection(name).where(field, op, value).get()
//   collection(name).get()
//   collection(name).count().get()
//   collection(name).orderBy(field, dir)
//
// The two error paths matter to the stores, so they are faithful:
//   create() on an existing document throws code 6 (ALREADY_EXISTS)
//   delete({ exists: true }) on a missing document throws code 5 (NOT_FOUND)
// Those two codes are the only atomic test-and-set primitives Firestore
// offers, so the fake must not soften them — a store that "wins" a race
// locally and loses it in production is exactly the bug a gate cannot
// see through a fake.
//
// The fake carries NO knowledge of any collection name. The stores choose
// their own collection names, and a fake that hard-coded them would make
// a rename invisible to the gates.

export function createFakeFirestore() {
  const collections = new Map();
  const coll = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };

  const snapshot = (id, data) => ({
    exists: data !== undefined,
    id,
    data: () => (data === undefined ? undefined : { ...data }),
  });

  const matches = (data, field, op, value) => {
    const has = Object.prototype.hasOwnProperty.call(data, field);
    if (op === '==') return has && data[field] === value;
    // A '!=' query does NOT match documents that lack the field.
    if (op === '!=') return has && data[field] !== value;
    if (op === '<') return has && data[field] < value;
    if (op === '<=') return has && data[field] <= value;
    if (op === '>') return has && data[field] > value;
    if (op === '>=') return has && data[field] >= value;
    throw new Error(`fake firestore: unsupported operator ${op}`);
  };

  const runQuery = (name, filters) => {
    const docs = [];
    for (const [id, data] of coll(name)) {
      if (filters.every((f) => matches(data, f.field, f.op, f.value))) {
        docs.push(snapshot(id, data));
      }
    }
    return { docs, size: docs.length, empty: docs.length === 0 };
  };

  const makeQuery = (name, filters) => ({
    where(field, op, value) {
      return makeQuery(name, [...filters, { field, op, value }]);
    },
    orderBy() {
      return makeQuery(name, filters);
    },
    limit(n) {
      return {
        async get() {
          const res = runQuery(name, filters);
          const docs = res.docs.slice(0, n);
          return { docs, size: docs.length, empty: docs.length === 0 };
        },
      };
    },
    async get() {
      return runQuery(name, filters);
    },
  });

  return {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              return snapshot(id, coll(name).get(id));
            },
            async set(data) {
              coll(name).set(id, { ...data });
            },
            async create(data) {
              if (coll(name).has(id)) {
                const e = new Error(`fake firestore: ${name}/${id} already exists`);
                e.code = 6; // ALREADY_EXISTS
                throw e;
              }
              coll(name).set(id, { ...data });
            },
            async delete(precondition) {
              if (precondition && precondition.exists && !coll(name).has(id)) {
                const e = new Error(`fake firestore: ${name}/${id} not found`);
                e.code = 5; // NOT_FOUND
                throw e;
              }
              coll(name).delete(id);
            },
          };
        },
        where(field, op, value) {
          return makeQuery(name, [{ field, op, value }]);
        },
        orderBy() {
          return makeQuery(name, []);
        },
        async get() {
          return runQuery(name, []);
        },
        count() {
          return {
            async get() {
              return { data: () => ({ count: coll(name).size }) };
            },
          };
        },
      };
    },
  };
}
