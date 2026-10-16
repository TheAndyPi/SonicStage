/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./public/index.html', './public/js/**/*.js'],
    darkMode: 'class',
    // Live track colors and playback states also appear in generated markup.
    // Keep their exact classes available if that markup moves between files.
    safelist: [
        'font-sans',
        'font-display',
        'font-mono',
        'text-[#f59e0b]',
        'text-[#06b6d4]',
        'text-[#8b5cf6]',
        'text-[#10b981]',
        'text-[#ec4899]',
        'text-[#f43f5e]',
        'ring-1',
        'ring-amber-300/90',
        'bg-white/15',
        'opacity-45',
        'bg-amber-400/25',
        'bg-cyan-500/25',
        'hover:bg-cyan-500/35',
        'hover:bg-rose-500/35',
        'text-rose-400',
        'text-amber-300',
        'text-emerald-400',
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['DM Sans', 'sans-serif'],
                display: ['Manrope', 'sans-serif'],
                mono: ['IBM Plex Mono', 'monospace'],
            },
            gridTemplateColumns: { 16: 'repeat(16, minmax(0, 1fr))' },
            screens: { xs: '480px' },
            spacing: { 0.2: '0.05rem' },
            opacity: { 15: '0.15', 35: '0.35', 45: '0.45' },
        },
    },
    plugins: [],
};
