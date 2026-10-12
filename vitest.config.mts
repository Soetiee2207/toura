import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) }, // giống "@/*" trong tsconfig.json
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"], // chạy 1 lần: migrate database test
    setupFiles: ["./tests/setup-env.ts"], // chạy trước mỗi file test: trỏ app sang DB test
    fileParallelism: false, // các file test dùng chung 1 DB → chạy lần lượt
  },
});
