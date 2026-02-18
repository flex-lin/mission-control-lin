import { describe, it, expect } from "vitest";
import { ok, created, err, notFound, serverError } from "@/lib/api-helpers";

describe("api-helpers", () => {
  describe("ok", () => {
    it("returns 200 with data", async () => {
      const res = ok({ message: "hello" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual({ message: "hello" });
    });

    it("includes meta when provided", async () => {
      const res = ok("test", { page: 1 });
      const body = await res.json();
      expect(body.data).toBe("test");
      expect(body.meta).toEqual({ page: 1 });
    });

    it("omits meta when not provided", async () => {
      const res = ok("test");
      const body = await res.json();
      expect(body.meta).toBeUndefined();
    });
  });

  describe("created", () => {
    it("returns 201 with data", async () => {
      const res = created({ id: 1 });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data).toEqual({ id: 1 });
    });
  });

  describe("err", () => {
    it("returns custom status with error message and code", async () => {
      const res = err("Bad input", "VALIDATION_ERROR", 422);
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe("Bad input");
      expect(body.code).toBe("VALIDATION_ERROR");
    });

    it("defaults to status 400", async () => {
      const res = err("Bad request", "BAD_REQUEST");
      expect(res.status).toBe(400);
    });
  });

  describe("notFound", () => {
    it("returns 404 with default message", async () => {
      const res = notFound();
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Not found");
      expect(body.code).toBe("NOT_FOUND");
    });

    it("returns 404 with custom message", async () => {
      const res = notFound("Team not found");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Team not found");
    });
  });

  describe("serverError", () => {
    it("extracts message from Error objects", async () => {
      const res = serverError(new Error("DB connection lost"));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("DB connection lost");
      expect(body.code).toBe("SERVER_ERROR");
    });

    it("uses default message for non-Error values", async () => {
      const res = serverError("some string error");
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Internal server error");
    });

    it("handles null/undefined", async () => {
      const res = serverError(null);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Internal server error");
    });
  });
});
