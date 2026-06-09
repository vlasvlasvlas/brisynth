# ROPESYNTH

Instrumento musical interactivo. Cuerdas de yute tensadas entre las rejas de hierro de un balcón de ciudad.

## Cómo usar

- **Crear soga**: arrastrá desde un gancho de la reja izquierda hasta la reja derecha
- **Tocar**: click o touch sobre cualquier cuerda
- **Arpa eólica**: pasá el mouse lento por encima de las cuerdas
- **Ajustar**: seleccioná una cuerda para cambiar tensión, decay y tono
- **ENV**: activá viento (mueve las sogas y genera drones), lluvia (gotas que percuten las cuerdas), cambiá la escala musical, el zoom y el rebote

## Entorno

La ciudad de fondo es pixel-art generativa — reacciona a la hora local y al clima real via [Open-Meteo](https://open-meteo.com/). Las luces de los edificios altos parpadean para avisos a aeronaves. De noche hay estrellas. Con lluvia activada aparecen las gotas sobre los techos.

## Stack

- [Three.js](https://threejs.org/) — escena 3D, físicas de cuerdas, `TubeGeometry`, raycasting para interacción
- Web Audio API — síntesis aditiva, Karplus-Strong, reverb convolucional, dron eólico con filtros resonantes
- Canvas 2D — ciudad pixel-art determinista (resolución interna 320×180, escalada `pixelated`)
- Open-Meteo — clima real sin API key
- [Vite](https://vitejs.dev/) — build

## Demo

[vlasvlavlas.github.io/ropesynth](https://vlasvlavlas.github.io/ropesynth)
