import express from "express";
import { chromium } from "playwright";
import fs from "fs";

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static("public"));

let browser = null;
const ARCHIVO = "./paquetes.json";


// =====================================================
// ARCHIVO
// =====================================================

function cargarPaquetes() {
    try {
        if (!fs.existsSync(ARCHIVO)) return [];
        return JSON.parse(fs.readFileSync(ARCHIVO, "utf8"));
    } catch (error) {
        console.error("Error leyendo paquetes.json:", error.message);
        return [];
    }
}

function guardarPaquetes(paquetes) {
    fs.writeFileSync(ARCHIVO, JSON.stringify(paquetes, null, 2), "utf8");
}


// =====================================================
// CHROME
// =====================================================

async function obtenerBrowser() {
    if (!browser) {
        browser = await chromium.launch({ headless: true });
    }
    return browser;
}


// =====================================================
// NORMALIZAR ESTADO
// =====================================================

function normalizarEstado(estado) {
    if (!estado) return "Sin consultar";
    const e = estado.toUpperCase().trim();

    if (e === "TRANSFERIDO DE" || e === "TRANSFERIDO") {
        return "EN TRÁNSITO A DESTINO";
    }
    if (e === "ARRIBADO") return "ARRIBADO A CUBA";
    if (e === "ENVIADO") return "ENVIADO";
    if (e === "REGISTRADO") return "REGISTRADO";
    if (e === "CREADA") return "CREADA";
    if (e === "ENTREGADO") return "ENTREGADO";
    if (e === "EN ADUANA") return "EN ADUANA";
    if (e === "LISTO PARA ENTREGA") return "LISTO PARA ENTREGA";

    return estado;
}


// =====================================================
// DETECTAR PROVINCIA / CIUDAD
// =====================================================

function detectarProvincia(t) {

    if (t.includes("santiago de cuba")) return "Santiago de Cuba";
    if (t.includes("pinar del río") || t.includes("pinar del rio")) return "Pinar del Río";
    if (t.includes("ciego de ávila") || t.includes("ciego de avila")) return "Ciego de Ávila";
    if (t.includes("la habana") || t.includes("habana")) return "La Habana";
    if (t.includes("camagüey") || t.includes("camaguey")) return "Camagüey";
    if (t.includes("holguín") || t.includes("holguin")) return "Holguín";
    if (t.includes("guantánamo") || t.includes("guantanamo")) return "Guantánamo";
    if (t.includes("santa clara")) return "Villa Clara (Santa Clara)";
    if (t.includes("villa clara")) return "Villa Clara";
    if (t.includes("matanzas")) return "Matanzas";
    if (t.includes("cienfuegos")) return "Cienfuegos";
    if (t.includes("las tunas")) return "Las Tunas";
    if (t.includes("granma")) return "Granma";
    if (t.includes("mayabeque")) return "Mayabeque";
    if (t.includes("artemisa")) return "Artemisa";

    return "";
}


// =====================================================
// DETECTAR UBICACIÓN (mejorado)
// =====================================================

function detectarUbicacion(detalle) {
    if (!detalle) return "";

    const t = detalle.toLowerCase();

    // =================================================
    // 1. ALMACÉN EN DESTINO
    // =================================================

    if (
        t.includes("almacén en destino") ||
        t.includes("almacen en destino") ||
        t.includes("recibido en almacén en destino") ||
        t.includes("recibido en almacen en destino")
    ) {
        const provincia = detectarProvincia(t);
        if (provincia) {
            return `Almacén de Destino (${provincia})`;
        }
        return "Almacén de Destino";
    }

    // =================================================
    // 2. REVISIÓN ADUANAL
    // =================================================

    if (
        t.includes("revisión aduanal") ||
        t.includes("revision aduanal")
    ) {
        if (t.includes("transcargo")) {
            return "Revisión Aduanal (Transcargo)";
        }
        const provincia = detectarProvincia(t);
        if (provincia) {
            return `Revisión Aduanal (${provincia})`;
        }
        return "Revisión Aduanal";
    }

    // =================================================
    // 3. ALMACÉN TRANSITORIO
    // =================================================

    if (
        t.includes("almacén transitorio") ||
        t.includes("almacen transitorio")
    ) {
        if (t.includes("transcargo")) {
            return "Almacén Transitorio Transcargo (La Habana)";
        }
        const provincia = detectarProvincia(t);
        if (provincia) {
            return `Almacén Transitorio (${provincia})`;
        }
        return "Almacén Transitorio";
    }

    // =================================================
    // 4. TERMINAL DE CONTENEDORES MARIEL
    // =================================================

    if (t.includes("terminal de contenedores mariel")) {
        return "Terminal de Contenedores Mariel";
    }

    // =================================================
    // 5. TRANSITARIA / TRANSCARGO
    // =================================================

    if (
        t.includes("transitaria transcargo") ||
        t.includes("transcargo")
    ) {
        return "Transitaria Transcargo";
    }

    // =================================================
    // 6. CONTENEDOR (en tránsito)
    // =================================================

    if (t.includes("montado en: contenedor")) {
        return "En contenedor - En tránsito a Cuba";
    }

    // =================================================
    // 7. ADUANA GENÉRICA
    // =================================================

    if (t.includes("aduana")) {
        return "Aduana";
    }

    // =================================================
    // 8. FALLBACK: buscar provincia
    // =================================================

    return detectarProvincia(t) || "";
}


// =====================================================
// CONSULTAR CUBAMAX
// =====================================================

async function consultarCubamax(numero, nombre) {

    const navegador = await obtenerBrowser();
    const page = await navegador.newPage();

    try {
        console.log("");
        console.log("==============================");
        console.log("Consultando Cubamax...");
        console.log("Paquete:", numero);
        console.log("Nombre:", nombre);
        console.log("==============================");

        await page.goto(
            "https://cubamax.com/es/tracking/shipment",
            { waitUntil: "domcontentloaded", timeout: 30000 }
        );

        const inputs = page.locator("input");
        const cantidad = await inputs.count();

        console.log("Campos encontrados:", cantidad);

        if (cantidad < 2) {
            throw new Error("No se encontraron los campos de búsqueda.");
        }

        await inputs.nth(0).fill(numero);
        await inputs.nth(1).fill(nombre);

        await page
            .getByRole("button", { name: /buscar/i })
            .click();

        try {
            await page.waitForFunction(
                () => {
                    const t = document.body.innerText.toLowerCase();
                    return t.includes("historial") ||
                           t.includes("estado actual") ||
                           t.includes("no encontrado");
                },
                { timeout: 30000 }
            );
        } catch (e) {
            console.log("Timeout esperando resultados, continuando...");
        }

        await page.waitForTimeout(3000);

        const texto = await page.locator("body").innerText();

        try {
            fs.writeFileSync("./debug-cubamax.txt", texto, "utf8");
        } catch (e) {}

        console.log("");
        console.log("RESPUESTA DE CUBAMAX:");
        console.log("------------------------------");
        console.log(texto);
        console.log("------------------------------");

        const lineas = texto
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(Boolean);

        // =================================================
        // PAQUETE CUBAMAX
        // =================================================

        let paqueteCubamax = numero;

        const indicePaquete = lineas.findIndex(
            l => l.toLowerCase().startsWith("paquete:")
        );

        if (indicePaquete !== -1) {
            paqueteCubamax = lineas[indicePaquete]
                .replace(/^paquete:\s*/i, "")
                .trim();
        }

        // =================================================
        // ESTADO OFICIAL
        // =================================================

        let estadoOficial = "";

        const indiceInfoEnvio = lineas.findIndex(
            l => l.toLowerCase() === "información del envío" ||
                 l.toLowerCase() === "informacion del envio"
        );

        if (indiceInfoEnvio !== -1) {
            const ignorar = [
                "datos generales",
                "transferido de",
                "información del envío",
                "informacion del envio"
            ];

            for (let i = indiceInfoEnvio - 1; i >= 0; i--) {
                const linea = lineas[i];
                const lower = linea.toLowerCase();

                if (ignorar.includes(lower)) continue;
                if (lower.startsWith("paquete:")) continue;

                estadoOficial = linea;
                break;
            }
        }

        console.log("");
        console.log("Estado oficial detectado:", estadoOficial);

        // =================================================
        // DESTINATARIO
        // =================================================

        let destinatario = "";

        const indiceDestinatario = lineas.findIndex(
            l => l.toLowerCase() === "nombre destinatario"
        );

        if (indiceDestinatario !== -1 && indiceDestinatario + 1 < lineas.length) {
            destinatario = lineas[indiceDestinatario + 1];
        }

        // =================================================
        // HISTORIAL
        // =================================================

        const indiceHistorial = lineas.findIndex(
            l => l.toLowerCase() === "historial completo del estado de tu paquete"
        );

        const indiceEstadoActual = lineas.findIndex(
            l => l.toLowerCase() === "estado actual"
        );

        if (indiceHistorial === -1 || indiceEstadoActual === -1) {
            return {
                ok: false,
                error: "No se encontró el historial del paquete."
            };
        }

        const historial = [];

        const regexFecha = /^[a-záéíóúñ]{3,4},\s+\d{1,2}\s+[a-záéíóúñ]{3,5}\s+\d{4}\s+·\s+\d{1,2}:\d{2}/i;

        for (let i = indiceHistorial + 1; i < indiceEstadoActual; i++) {

            const linea = lineas[i];

            if (regexFecha.test(linea)) {

                const lineaAnterior = lineas[i - 1] || "";

                let detalle = "";
                if (i + 1 < indiceEstadoActual) {
                    const siguiente = lineas[i + 1];
                    if (!regexFecha.test(siguiente)) {
                        detalle = siguiente;
                    }
                }

                historial.push({
                    estado: normalizarEstado(lineaAnterior),
                    fecha: linea,
                    detalle: detalle
                });
            }
        }

        console.log("Estados en historial:", historial.length);

        // =================================================
        // ÚLTIMO MOVIMIENTO
        // =================================================

        const ultimoMovimiento =
            historial.length > 0
                ? historial[historial.length - 1]
                : null;

        // =================================================
        // ESTADO PRINCIPAL
        // =================================================

        let estado = "Sin consultar";

        if (estadoOficial) {
            estado = normalizarEstado(estadoOficial);
        } else if (ultimoMovimiento) {
            estado = ultimoMovimiento.estado;
        }

        // =================================================
        // UBICACIÓN
        // =================================================

        let ubicacion = "";

        if (ultimoMovimiento) {
            ubicacion = detectarUbicacion(ultimoMovimiento.detalle);
        }
        if (!ubicacion) {
            for (let j = historial.length - 1; j >= 0; j--) {
                const encontrada = detectarUbicacion(historial[j].detalle);
                if (encontrada) {
                    ubicacion = encontrada;
                    break;
                }
            }
        }

        console.log("");
        console.log("================================");
        console.log("ESTADO PRINCIPAL:", estado);
        console.log("PAQUETE CUBAMAX:", paqueteCubamax);
        console.log("DESTINATARIO:", destinatario);
        console.log("UBICACIÓN:", ubicacion || "No indicada");
        if (ultimoMovimiento) {
            console.log("FECHA ÚLTIMO MOVIMIENTO:", ultimoMovimiento.fecha);
            console.log("DETALLE:", ultimoMovimiento.detalle);
        }
        console.log("================================");

        return {
            ok: true,
            paquete: numero,
            paqueteCubamax,
            destinatario,
            estado,
            ubicacion,
            ultimoMovimiento,
            historial
        };

    } catch (error) {
        console.error("Error consultando Cubamax:", error.message);
        return { ok: false, error: error.message };
    } finally {
        await page.close();
    }
}


// =====================================================
// ACTUALIZAR UN PAQUETE
// =====================================================

async function actualizarPaquete(paquete) {

    const resultado = await consultarCubamax(
        paquete.numero,
        paquete.nombre
    );

    if (resultado.ok) {
        paquete.estado = resultado.estado;
        paquete.ubicacion = resultado.ubicacion;
        paquete.ultimoMovimiento = resultado.ultimoMovimiento;
        paquete.historial = resultado.historial;
        paquete.destinatario = resultado.destinatario;
        paquete.paqueteCubamax = resultado.paqueteCubamax;
        paquete.ultimaActualizacion = new Date().toLocaleString("es-ES");
        paquete.error = null;
    } else {
        paquete.error = resultado.error;
    }

    return paquete;
}


// =====================================================
// ACTUALIZAR TODOS
// =====================================================

async function actualizarTodosLosPaquetes() {

    console.log("");
    console.log("==================================");
    console.log("ACTUALIZACIÓN DE PAQUETES");
    console.log(new Date().toLocaleString("es-ES"));
    console.log("==================================");

    const paquetes = cargarPaquetes();

    for (const paquete of paquetes) {
        try {
            console.log("");
            console.log("Actualizando:", paquete.numero);
            await actualizarPaquete(paquete);
            await new Promise(r => setTimeout(r, 2000));
        } catch (error) {
            console.error("Error:", paquete.numero, error.message);
        }
    }

    guardarPaquetes(paquetes);

    console.log("");
    console.log("Actualización terminada.");
}


// =====================================================
// API
// =====================================================

app.get("/api/paquetes", (req, res) => {
    res.json({ ok: true, paquetes: cargarPaquetes() });
});

app.post("/api/paquetes", (req, res) => {

    const { nombre, numero } = req.body;

    if (!nombre || !numero) {
        return res.status(400).json({
            ok: false,
            error: "Falta el nombre o el número del paquete."
        });
    }

    const paquetes = cargarPaquetes();

    const nuevo = {
        id: Date.now(),
        nombre: nombre.trim(),
        numero: numero.trim(),
        estado: "Sin consultar",
        ubicacion: "",
        ultimoMovimiento: null,
        historial: [],
        destinatario: "",
        paqueteCubamax: numero.trim(),
        ultimaActualizacion: null,
        error: null
    };

    paquetes.push(nuevo);
    guardarPaquetes(paquetes);

    res.json({ ok: true, paquete: nuevo });
});

app.delete("/api/paquetes/:id", (req, res) => {

    const id = Number(req.params.id);
    let paquetes = cargarPaquetes();
    paquetes = paquetes.filter(p => p.id !== id);
    guardarPaquetes(paquetes);
    res.json({ ok: true });
});

app.post("/api/rastrear", async (req, res) => {

    const { numero, nombre } = req.body;

    if (!numero || !nombre) {
        return res.status(400).json({
            ok: false,
            error: "Falta el nombre o el número."
        });
    }

    try {
        const resultado = await consultarCubamax(
            numero.trim(),
            nombre.trim()
        );

        if (resultado.ok) {
            const paquetes = cargarPaquetes();
            const paquete = paquetes.find(
                p => p.numero.toLowerCase() === numero.trim().toLowerCase()
            );

            if (paquete) {
                paquete.estado = resultado.estado;
                paquete.ubicacion = resultado.ubicacion;
                paquete.ultimoMovimiento = resultado.ultimoMovimiento;
                paquete.historial = resultado.historial;
                paquete.destinatario = resultado.destinatario;
                paquete.paqueteCubamax = resultado.paqueteCubamax;
                paquete.ultimaActualizacion = new Date().toLocaleString("es-ES");
                paquete.error = null;
                guardarPaquetes(paquetes);
            }
        }

        res.json(resultado);

    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.post("/api/actualizar-todos", async (req, res) => {
    try {
        await actualizarTodosLosPaquetes();
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});


// =====================================================
// ACTUALIZACIÓN AUTOMÁTICA
// =====================================================

const UNA_HORA = 1 * 60 * 60 * 1000;

setTimeout(() => {
    actualizarTodosLosPaquetes().catch(err => {
        console.error("Error en actualización inicial:", err);
    });
}, 10000);

setInterval(() => {
    actualizarTodosLosPaquetes().catch(err => {
        console.error("Error en actualización automática:", err);
    });
}, UNA_HORA);


// =====================================================
// SERVIDOR
// =====================================================

app.listen(PORT, () => {
    console.log("");
    console.log("==================================");
    console.log(" MIS PAQUETES - CUBAMAX");
    console.log("==================================");
    console.log(`Página: http://localhost:${PORT}`);
    console.log("Servidor iniciado correctamente.");
    console.log("Actualización automática: cada 1 hora.");
    console.log("Se actualizará todo 10 segundos después de arrancar.");
    console.log("==================================");
});