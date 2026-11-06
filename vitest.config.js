import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
    test: {
        // 作業用のコピー（worktree）のテストは数えない
        exclude: [...configDefaults.exclude, '.claude/**']
    }
});
