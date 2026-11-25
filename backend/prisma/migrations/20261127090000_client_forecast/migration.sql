-- Nova previsão combinada com o cliente, separada do prazo do plano.
ALTER TABLE "tickets" ADD COLUMN "client_forecast_at" TIMESTAMP(3);
