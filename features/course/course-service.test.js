const test = require("node:test");
const assert = require("node:assert/strict");

const { createCourseService } = require("./course-service.js");

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function createService(overrides = {}) {
  let id = 0;
  return createCourseService({
    storage: createMemoryStorage(),
    now: () => "2026-07-15T08:00:00.000Z",
    uuid: () => `generated-${++id}`,
    ...overrides
  });
}

test("student joins a pre-created group by case-insensitive code", async () => {
  const service = createService();
  const group = await service.createGroup("第1小组", "ABC123");

  const context = await service.joinGroup(" abc123 ", {
    name: "张三",
    student_id: "2026001"
  });

  assert.equal(context.group.id, group.id);
  assert.equal(context.membership.studentKey, "2026001::张三");
  assert.equal(context.group.spaceId, `group-space-${group.id}`);
});

test("student cannot join a second group in the same course", async () => {
  const service = createService();
  await service.createGroup("第1小组", "ABC123");
  await service.createGroup("第2小组", "DEF456");
  const user = { name: "张三", student_id: "2026001" };

  await service.joinGroup("ABC123", user);

  await assert.rejects(() => service.joinGroup("DEF456", user), {
    code: "COURSE_GROUP_CONFLICT"
  });
});

test("locked group rejects a new member", async () => {
  const service = createService();
  const group = await service.createGroup("第1小组", "ABC123");
  await service.setGroupLocked(group.id, true);

  await assert.rejects(
    () => service.joinGroup("ABC123", { name: "李四", student_id: "2026002" }),
    { code: "GROUP_LOCKED" }
  );
});

test("task progress is stored per student without duplicate ids", async () => {
  const service = createService();
  const user = { name: "张三", student_id: "2026001" };

  await service.setTaskComplete("learning-ready", true, user);
  await service.setTaskComplete("learning-ready", true, user);
  await service.setTaskComplete("survey-collect", true, user);

  assert.deepEqual((await service.getProgress(user)).completedTaskIds, [
    "learning-ready",
    "survey-collect"
  ]);
});

test("load context combines the current membership, group and progress", async () => {
  const service = createService();
  const user = { name: "张三", student_id: "2026001" };
  const group = await service.createGroup("第1小组", "ABC123");
  await service.joinGroup("ABC123", user);
  await service.setTaskComplete("learning-ready", true, user);

  const context = await service.loadContext(user);

  assert.equal(context.group.id, group.id);
  assert.equal(context.membership.studentKey, "2026001::张三");
  assert.deepEqual(context.progress.completedTaskIds, ["learning-ready"]);
});

test("local state remains usable when Supabase mirror fails", async () => {
  const supabaseClient = {
    from() {
      return {
        async upsert() {
          return { error: new Error("offline") };
        }
      };
    }
  };
  const service = createService({ supabaseClient });

  const group = await service.createGroup("第1小组", "ABC123");

  assert.equal(group.name, "第1小组");
  assert.equal(group.syncPending, true);
  assert.equal((await service.listGroups()).length, 1);
});

test("local course state is isolated by teaching project", async () => {
  const storage = createMemoryStorage();
  const first = createService({ storage, teachingProjectId: "semester-a" });
  const second = createService({ storage, teachingProjectId: "semester-b" });
  await first.createGroup("第一学期小组", "TERM01");
  assert.equal((await first.listGroups()).length, 1);
  assert.equal((await second.listGroups()).length, 0);
});

test("join fetches teacher-created groups from the remote store on another device", async () => {
  const remoteStore = {
    async listGroups() {
      return [
        {
          id: "remote-group-1",
          course_id: "mibu-village-planning",
          name: "第1小组",
          join_code: "ABC123",
          locked: false,
          space_id: "group-space-remote-group-1"
        }
      ];
    }
  };
  const service = createService({ remoteStore });

  const context = await service.joinGroup("ABC123", {
    name: "张三",
    student_id: "2026001"
  });

  assert.equal(context.group.id, "remote-group-1");
  assert.equal((await service.listGroups()).length, 1);
});

test("load context restores membership and progress created on another device", async () => {
  const user = { name: "张三", student_id: "2026001" };
  const service = createCourseService({
    storage: createMemoryStorage(),
    remoteStore: {
      async listGroups() {
        return [{ id: "g-remote", name: "远端小组", join_code: "REMOTE", space_id: "group-space-g-remote" }];
      },
      async loadStudentContext() {
        return {
          membership: { group_id: "g-remote", student_key: "2026001::张三", student_name: "张三", student_id: "2026001" },
          progress: [{ group_id: "g-remote", student_key: "2026001::张三", task_id: "join-group", completed: true }]
        };
      }
    }
  });
  const context = await service.loadContext(user);
  assert.equal(context.group.id, "g-remote");
  assert.deepEqual(context.progress.completedTaskIds, ["join-group"]);
});
