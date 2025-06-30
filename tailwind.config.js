module.exports = {
  purge: [
    './public/**/*.html',
    './public/**/*.js',
  ],
  darkMode: 'class', // or 'media' or 'class'
  theme: {
    extend: {
      colors: {
        'bg-primary': 'var(--bg-primary)',
        'bg-secondary': 'var(--bg-secondary)',
        'bg-tertiary': 'var(--bg-tertiary)',
        'border': 'var(--border)',
        'border-hover': 'var(--border-hover)',
        'accent': 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        'success': 'var(--success)',
        'warning': 'var(--warning)',
        'error': 'var(--error)',
      },
      boxShadow: {
        'sm': 'var(--shadow-sm)',
        'md': 'var(--shadow-md)',
        'lg': 'var(--shadow-lg)',
      },
      backgroundColor: {
        'glass-bg': 'var(--glass-bg)',
      },
      borderColor: {
        'glass-border': 'var(--glass-border)',
      }
    },
  },
  variants: {
    extend: {},
  },
  plugins: [],
} ,
{
    "scripts": {
      "build:css": "tailwindcss -i ./src/input.css -o ./public/styles.css --minify",
      "build": "npm run build:css && mkdir -p dist && cp -r public/* dist/",
      "dev": "tailwindcss -i ./src/input.css -o ./public/styles.css --watch",
      "deploy": "npm run build && wrangler pages deploy dist --project-name neuro-place"
    }
}
