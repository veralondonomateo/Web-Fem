import { Suspense } from "react";
import ThankYouClient from "./ThankYouClient";

export const metadata = {
  title: "FEM | ¡Gracias por tu compra!",
  description: "Tu pedido fue confirmado – FEM Suplementos",
};

export default function ThankYouPage() {
  return (
    <Suspense>
      <ThankYouClient />
    </Suspense>
  );
}
