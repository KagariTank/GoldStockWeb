import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// GitHub Pages 仓库名，如果是主站点 username.github.io 则设为 '/'
const repoName = 'GoldStockWeb'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  base: repoName ? `/${repoName}/` : '/',
  server: {
    proxy: {
      '/em-api': {
        target: 'https://data.eastmoney.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/em-api/, '')
      },
      '/hsd-api': {
        target: 'https://dq.10jqka.com.cn',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/hsd-api/, '')
      },
      '/em-ex-api': {
        target: 'https://push2ex.eastmoney.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/em-ex-api/, '')
      }
    }
  }
})