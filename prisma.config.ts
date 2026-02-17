import path from "path"
import { defineConfig } from "prisma/config"

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: `file:${path.resolve("prisma/mission-control.db")}`,
  },
})
