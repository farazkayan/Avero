import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'

export interface ThemeSwitchProps {
  className?: string
}

function getInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  const saved = localStorage.getItem('theme')
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeSwitch({ className = '' }: ThemeSwitchProps) {
  // Try using the app's ThemeContext; fall back gracefully to local state if standalone
  let themeFromContext: 'light' | 'dark' | undefined
  let toggleFromContext: (() => void) | undefined

  try {
    const ctx = useTheme()
    themeFromContext = ctx.theme === 'dark' ? 'dark' : 'light'
    toggleFromContext = ctx.toggleTheme
  } catch {
    // Rendered outside ThemeProvider (e.g. standalone demo)
  }

  const [localTheme, setLocalTheme] = React.useState<'light' | 'dark'>(getInitialTheme)

  const currentTheme = themeFromContext ?? localTheme

  // Toggle theme
  const toggleTheme = React.useCallback(() => {
    if (toggleFromContext) {
      toggleFromContext()
      return
    }
    const newTheme = localTheme === 'light' ? 'dark' : 'light'
    setLocalTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    document.documentElement.classList.toggle('dark', newTheme === 'dark')
  }, [toggleFromContext, localTheme])

  return (
    <button
      onClick={toggleTheme}
      aria-label={currentTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-surface-container hover:bg-surface-container-high dark:bg-inverse-surface dark:hover:bg-outline transition-colors text-on-surface-variant dark:text-surface-container-lowest overflow-hidden ${className}`}
    >
      <Sun
        className={`absolute h-5 w-5 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
          currentTheme === 'light'
            ? 'scale-100 translate-y-0 opacity-100'
            : 'scale-50 translate-y-5 opacity-0'
        }`}
      />
      <Moon
        className={`absolute h-5 w-5 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
          currentTheme === 'dark'
            ? 'scale-100 translate-y-0 opacity-100'
            : 'scale-50 translate-y-5 opacity-0'
        }`}
      />
    </button>
  )
}

export default ThemeSwitch
