export const routes = {
  discover: '/',
  login: '/login',
  search: '/search',
  library: '/library',
  daily: '/daily',
  downloads: '/downloads',
  history: '/history',
  settings: '/settings',
  playlist: '/playlist/:id',
  album: '/album/:id',
  artist: '/artist/:id',
  song: '/song/:id',
  user: '/user/:id',
  personalCenter: '/me',
  rank: '/rank'
} as const

export type AppRouteKey = keyof typeof routes
