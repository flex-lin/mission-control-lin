import path from "path"
import { PrismaClient } from "@/lib/generated/prisma/client"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"

const DB_PATH = path.resolve(process.cwd(), "prisma/mission-control.db")

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({ url: DB_PATH })
  return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0])
}

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

export const db: PrismaClient =
  globalThis.__prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = db
}
