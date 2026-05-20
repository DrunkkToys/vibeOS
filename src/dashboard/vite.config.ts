import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
export default defineConfig({plugins:[solid()],base:"/",build:{outDir:"dist",emptyOutDir:true},server:{port:5173,proxy:{"/status":"http://127.0.0.1:9578","/savings":"http://127.0.0.1:9578","/sessions":"http://127.0.0.1:9578","/reports":"http://127.0.0.1:9578","/diagnose":"http://127.0.0.1:9578","/project":"http://127.0.0.1:9578","/trinity":"http://127.0.0.1:9578","/research-audit":"http://127.0.0.1:9578","/events":"http://127.0.0.1:9578"}}})
