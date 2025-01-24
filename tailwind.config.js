/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,js}",
    "./index.html",
    "./public/**/*.{html,js}"
  ],
  theme: {
    
    extend: {
      fontFamily: {
        'host': ['Host Grotesk', 'sans-serif'],
      },
      colors: {
        'egg-yellow': '#F2DA8A',
        'egg-white': '#f5f0e6',
        'egg-brown': '#d68c45',
        'dark-brown': '#4b2e15',
        'light-gray': '#f4f4f4',
      },
    }
  },
  plugins: [],
}