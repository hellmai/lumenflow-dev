// ../../../vitest.config.ts
import { defineConfig } from "file:///home/tom/source/hellmai/os/node_modules/.pnpm/vitest@4.0.17_@types+node@22.19.6_yaml@2.8.2/node_modules/vitest/dist/config.js";
var vitest_config_default = defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/__tests__/**/*.test.ts", "packages/**/*.spec.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["**/node_modules/**", "**/dist/**", "**/__tests__/**", "**/*.config.*"],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    },
    passWithNoTests: true
  }
});
export {
  vitest_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vLi4vdml0ZXN0LmNvbmZpZy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9ob21lL3RvbS9zb3VyY2UvaGVsbG1haS9vc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2hvbWUvdG9tL3NvdXJjZS9oZWxsbWFpL29zL3ZpdGVzdC5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL2hvbWUvdG9tL3NvdXJjZS9oZWxsbWFpL29zL3ZpdGVzdC5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlc3QvY29uZmlnJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgdGVzdDoge1xuICAgIGdsb2JhbHM6IHRydWUsXG4gICAgZW52aXJvbm1lbnQ6ICdub2RlJyxcbiAgICBpbmNsdWRlOiBbJ3BhY2thZ2VzLyoqL19fdGVzdHNfXy8qKi8qLnRlc3QudHMnLCAncGFja2FnZXMvKiovKi5zcGVjLnRzJ10sXG4gICAgZXhjbHVkZTogWycqKi9ub2RlX21vZHVsZXMvKionLCAnKiovZGlzdC8qKiddLFxuICAgIGNvdmVyYWdlOiB7XG4gICAgICBwcm92aWRlcjogJ3Y4JyxcbiAgICAgIHJlcG9ydGVyOiBbJ3RleHQnLCAnanNvbicsICdodG1sJ10sXG4gICAgICBleGNsdWRlOiBbJyoqL25vZGVfbW9kdWxlcy8qKicsICcqKi9kaXN0LyoqJywgJyoqL19fdGVzdHNfXy8qKicsICcqKi8qLmNvbmZpZy4qJ10sXG4gICAgICB0aHJlc2hvbGRzOiB7XG4gICAgICAgIGdsb2JhbDoge1xuICAgICAgICAgIGJyYW5jaGVzOiA4MCxcbiAgICAgICAgICBmdW5jdGlvbnM6IDgwLFxuICAgICAgICAgIGxpbmVzOiA4MCxcbiAgICAgICAgICBzdGF0ZW1lbnRzOiA4MCxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBwYXNzV2l0aE5vVGVzdHM6IHRydWUsXG4gIH0sXG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBdVEsU0FBUyxvQkFBb0I7QUFFcFMsSUFBTyx3QkFBUSxhQUFhO0FBQUEsRUFDMUIsTUFBTTtBQUFBLElBQ0osU0FBUztBQUFBLElBQ1QsYUFBYTtBQUFBLElBQ2IsU0FBUyxDQUFDLHNDQUFzQyx1QkFBdUI7QUFBQSxJQUN2RSxTQUFTLENBQUMsc0JBQXNCLFlBQVk7QUFBQSxJQUM1QyxVQUFVO0FBQUEsTUFDUixVQUFVO0FBQUEsTUFDVixVQUFVLENBQUMsUUFBUSxRQUFRLE1BQU07QUFBQSxNQUNqQyxTQUFTLENBQUMsc0JBQXNCLGNBQWMsbUJBQW1CLGVBQWU7QUFBQSxNQUNoRixZQUFZO0FBQUEsUUFDVixRQUFRO0FBQUEsVUFDTixVQUFVO0FBQUEsVUFDVixXQUFXO0FBQUEsVUFDWCxPQUFPO0FBQUEsVUFDUCxZQUFZO0FBQUEsUUFDZDtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsSUFDQSxpQkFBaUI7QUFBQSxFQUNuQjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
