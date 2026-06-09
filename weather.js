// weather.js — Clima real con geolocalización y hora local

export async function fetchWeather() {
  const localHour = new Date().getHours();

  try {
    // Intentar geolocalización del usuario
    let lat = -34.6037; // Buenos Aires por defecto
    let lon = -58.3816;

    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 })
      );
      lat = pos.coords.latitude;
      lon = pos.coords.longitude;
    } catch {
      // Sin geolocalización: usar coordenadas por defecto
    }

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,is_day,precipitation,wind_speed_10m,cloud_cover` +
      `&timezone=auto`;

    const response = await fetch(url);
    if (!response.ok) throw new Error('Weather API error');
    const data = await response.json();

    return {
      isDay:       data.current.is_day === 1,
      temperature: data.current.temperature_2m,
      precipitation: data.current.precipitation,
      windSpeed:   data.current.wind_speed_10m,
      cloudCover:  data.current.cloud_cover, // 0–100
      localHour,
    };
  } catch {
    // Fallback con la hora local real
    return {
      isDay:       localHour >= 6 && localHour < 20,
      temperature: 18,
      precipitation: 0,
      windSpeed:   8,
      cloudCover:  35,
      localHour,
    };
  }
}
