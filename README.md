# BRISYNTH

Instrumento musical interactivo. Cuerdas de yute tensadas entre las rejas de hierro de un balcón de ciudad.

## Cómo usar

- **Crear soga**: click o touch en un gancho izquierdo y después en un gancho derecho
- **Tocar**: click o touch sobre cualquier cuerda
- **Arpa eólica**: pasá el mouse lento por encima de las cuerdas
- **Ajustar**: seleccioná una cuerda para cambiar tensión y tono
- **ENV**: activá viento, lluvia y mariposas musicales; cambiá la escala, el zoom y el rebote
- **Mariposas**: aterrizan al azar y pulsan las cuerdas; al tocarlas vuelan hacia otra y el viento puede desplazarlas

## Entorno

La ciudad de fondo es pixel-art generativa — reacciona a la hora local y al clima real via [Open-Meteo](https://open-meteo.com/). Las luces de los edificios altos parpadean para avisos a aeronaves. De noche hay estrellas. Con lluvia activada aparecen las gotas sobre los techos. La fauna usa sprites pixel-art generados para BRISYNTH y funciona como un secuenciador aleatorio sobre las cuerdas.

## Stack

- [Three.js](https://threejs.org/) — escena 3D, físicas de cuerdas, `TubeGeometry`, raycasting para interacción
- Web Audio API — síntesis aditiva, Karplus-Strong, reverb convolucional, dron eólico con filtros resonantes
- Canvas 2D — ciudad pixel-art determinista (resolución interna 320×180, escalada `pixelated`)
- Open-Meteo — clima real sin API key
- [Vite](https://vitejs.dev/) — build

## Demo

[vlasvlasvlas.github.io/brisynth](https://vlasvlasvlas.github.io/brisynth)
