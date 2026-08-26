import base from './vite.config'
export default { ...base, server: { watch: { ignored: ['**/fixtures/**', '**/dist*/**', '**/node_modules/**'] } } }
