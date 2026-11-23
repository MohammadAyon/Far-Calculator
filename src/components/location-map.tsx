"use client";

import { useEffect, useMemo } from "react";
import {
  GeoJSON,
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { Feature } from "geojson";
import "leaflet/dist/leaflet.css";
import type { RuleDataset } from "@/lib/rules";

type Props = {
  dataset: RuleDataset;
  selectedBlockId: string;
  point: [number, number] | null;
  onSelectBlock: (id: string) => void;
  onSelectPoint: (point: [number, number]) => void;
};

function MapResizeHandler() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(container);
    const frame = window.requestAnimationFrame(() => map.invalidateSize({ pan: false }));

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [map]);

  return null;
}

function MapClickHandler({
  onSelectPoint,
}: {
  onSelectPoint: Props["onSelectPoint"];
}) {
  useMapEvents({
    click(event) {
      onSelectPoint([event.latlng.lat, event.latlng.lng]);
    },
  });
  return null;
}

export default function LocationMap({
  dataset,
  selectedBlockId,
  point,
  onSelectBlock,
  onSelectPoint,
}: Props) {
  const mappedBlocks = useMemo(
    () =>
      dataset.blocks.flatMap((block) =>
        block.geometry
          ? [
              {
                id: block.id,
                feature: {
                  type: "Feature" as const,
                  properties: { id: block.id, label: block.label },
                  geometry: block.geometry,
                } satisfies Feature,
              },
            ]
          : [],
      ),
    [dataset.blocks],
  );

  return (
    <MapContainer
      center={[23.8103, 90.4125]}
      zoom={11}
      scrollWheelZoom
      className="map-canvas"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapResizeHandler />
      {mappedBlocks.map(({ id, feature }) => (
        <GeoJSON
          key={id}
          data={feature}
          style={{
            color: id === selectedBlockId ? "#1b6c58" : "#438b79",
            weight: id === selectedBlockId ? 3 : 1,
            fillColor: id === selectedBlockId ? "#70c2a3" : "#acd9c7",
            fillOpacity: id === selectedBlockId ? 0.42 : 0.2,
          }}
          onEachFeature={(_feature, layer) => {
            layer.on("click", () => onSelectBlock(id));
          }}
        />
      ))}
      {point && <Marker position={point} />}
      <MapClickHandler onSelectPoint={onSelectPoint} />
    </MapContainer>
  );
}
