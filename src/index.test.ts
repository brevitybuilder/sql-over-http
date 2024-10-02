import { expect, it } from "vitest";
import { postgres } from ".";

// TODO
it("should generate simple query", () => {
  const sql = postgres("", { arrayMode: false });
  const values = sql`SELECT * FROM table WHERE column = ${"value"} and another = ${"other"}`;
  expect(values.prepare()).toEqual({
    query: "SELECT * FROM table WHERE column = $1 and another = $2",
    params: ["value", "other"],
  });
});

it("should handle nulls", () => {
  const sql = postgres("", { arrayMode: false });
  const user = {
    email: "nick@devize.com",
    phone: "+1234567890",
    emailVerified: true,
    phoneVerified: true,
    given_name: "Nick",
    family_name: "Randall",
    image: undefined,
  };
  const query = sql`INSERT INTO "auth"."users" ("email", "emailVerified", "phone", "phoneVerified", "given_name", "family_name", "image") VALUES (${user?.email?.toLowerCase() ?? null}, ${user.emailVerified ?? null
    }, ${user.phone ?? null}, ${user.phoneVerified ?? null}, ${user.given_name ?? null}, ${user.family_name ?? null}, ${user.image ?? null
    }) ON CONFLICT (email) DO UPDATE SET "email" = LOWER(EXCLUDED.email) RETURNING *`;

  expect(query.prepare()).toEqual({
    query:
      'INSERT INTO "auth"."users" ("email", "emailVerified", "phone", "phoneVerified", "given_name", "family_name", "image") VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (email) DO UPDATE SET "email" = LOWER(EXCLUDED.email) RETURNING *',
    params: [
      "nick@devize.com",
      "t",
      "+1234567890",
      "t",
      "Nick",
      "Randall",
      "null",
    ],
  });
});

it("should handle pre-compiled queries", () => {
  const sql = postgres("", { arrayMode: false });
  const values = sql("SELECT * FROM table WHERE column = $1", ["value"]);
  expect(values.prepare()).toEqual({
    query: "SELECT * FROM table WHERE column = $1",
    params: ["value"],
  });
});

it("should handle escaping identifiers", () => {
  const sql = postgres("", { arrayMode: false });
  const tableName = "MyTable"
  const values = sql`SELECT 1 FROM ${sql(tableName)}`;
  expect(values.prepare()).toEqual({
    query: 'SELECT 1 FROM "MyTable"',
    params: [],
  });
});
