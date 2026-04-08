# restraintTM

restraintTM es una extension de VS Code para limitar el tiempo de trabajo continuo en proyectos concretos y forzar pausas de cooldown.

La extension esta pensada para evitar sesiones demasiado largas en un solo proyecto, especialmente en proyectos personales o de hobby.

## Caracteristicas

- Configuracion de proyectos limitados por nombre de carpeta.
- Tiempo de trabajo configurable por proyecto.
- Cooldown configurable por proyecto.
- Temporizador visible en la barra inferior solo cuando el proyecto actual esta limitado.
- Bloqueo visual cuando el tiempo llega a cero.
- Persistencia del estado entre reinicios de VS Code.
- Restriccion de edicion/eliminacion para proyectos bloqueados.

## Como funciona

1. Abres la configuracion de restraintTM.
2. Anades un proyecto con:
- Nombre de carpeta
- Minutos de trabajo
- Minutos de cooldown
3. Si abres una carpeta con ese nombre, aparece el temporizador.
4. Al llegar a 00:00:00:
- El proyecto entra en estado bloqueado.
- Se muestra una vista de bloqueo persistente.
- Comienza el cooldown en segundo plano.
5. Cuando termina el cooldown, el tiempo de trabajo se reinicia automaticamente.

## Uso

Comando disponible en la paleta:

- restraintTM: Abrir configuracion

Desde esa pantalla puedes crear, editar y eliminar entradas, salvo las entradas que esten bloqueadas en ese momento.

## Instalacion local para pruebas

1. Compilar:

```bash
npm run package
```

2. Generar VSIX:

```bash
npx @vscode/vsce package
```

3. Instalar en VS Code:

```bash
code --install-extension restrainttm-0.0.1.vsix
```

Tambien puedes instalar el archivo VSIX desde Extensions > menu de opciones > Install from VSIX.

## Desarrollo

Para ejecutar en modo desarrollo:

1. Abre este workspace en VS Code.
2. Ejecuta la configuracion Run Extension con F5.
3. En la nueva ventana (Extension Development Host), usa el comando restraintTM: Abrir configuracion.

## Estado actual

Version actual: 0.0.1

Implementado:

- Core de temporizador y cooldown
- Persistencia en globalState
- Status bar contextual
- Webview de configuracion
- Vista de bloqueo

## Limitaciones conocidas

- La deteccion de proyecto usa la primera carpeta del workspace (no multi-root completo).
- El bloqueo es de tipo cooperativo (visual), no impide al 100% toda accion posible del editor.

## Release Notes

### 0.0.1

- Primera version funcional de restraintTM.
- Configuracion por proyecto con tiempo de trabajo y cooldown.
- Temporizador en status bar para proyectos limitados.
- Bloqueo visual y reinicio automatico tras cooldown.
