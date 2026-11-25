// MRT Line 6 stations (public locations). The TOD incentive itself is set by the
// TOD Guideline 2025 (DAP Table 3.28 row 6), so this only reports the distance.
export const mrtLine6Stations = [
  { name: "Uttara North (Diabari)", lat: 23.8694, lng: 90.3675 },
  { name: "Uttara Center", lat: 23.8598, lng: 90.3651 },
  { name: "Uttara South", lat: 23.8456, lng: 90.3631 },
  { name: "Pallabi", lat: 23.8262, lng: 90.3642 },
  { name: "Mirpur 11", lat: 23.8191, lng: 90.3653 },
  { name: "Mirpur 10", lat: 23.8084, lng: 90.3682 },
  { name: "Kazipara", lat: 23.7992, lng: 90.372 },
  { name: "Shewrapara", lat: 23.7909, lng: 90.3755 },
  { name: "Agargaon", lat: 23.77842, lng: 90.38004 },
  { name: "Bijoy Sarani", lat: 23.76655, lng: 90.38311 },
  { name: "Farmgate", lat: 23.75904, lng: 90.38709 },
  { name: "Karwan Bazar", lat: 23.7513, lng: 90.3927 },
  { name: "Shahbagh", lat: 23.7395, lng: 90.396 },
  { name: "Dhaka University", lat: 23.73143, lng: 90.39703 },
  { name: "Bangladesh Secretariat", lat: 23.73, lng: 90.4075 },
  { name: "Motijheel", lat: 23.7281, lng: 90.4191 },
  { name: "Kamalapur", lat: 23.733, lng: 90.4255, opens: "2027" },
] as const;

export function nearestMrtStation(lat: number, lng: number) {
  const toRad = Math.PI / 180;
  const distance = (s: (typeof mrtLine6Stations)[number]) => {
    const dLat = (s.lat - lat) * toRad;
    const dLng = (s.lng - lng) * toRad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat * toRad) * Math.cos(s.lat * toRad) * Math.sin(dLng / 2) ** 2;
    return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
  };
  return mrtLine6Stations
    .map((station) => ({ station, meters: distance(station) }))
    .reduce((best, item) => (item.meters < best.meters ? item : best));
}
