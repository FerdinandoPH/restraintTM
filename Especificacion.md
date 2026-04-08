DOCUMENTO DE ESPECIFICACIÓN

RESTRAINT™

# DESCRIPCIÓN

Restraint™ es una extensión de VSCode que limita el tiempo seguido que puedes pasar en un determinado proyecto, para evitar burnouts y no pasar demasiado tiempo en un proyecto de hobby, lo que hace que desatienda otras tareas.

Cada proyecto incluido en la aplicación tendrá un tiempo de trabajo, que irá descontándose a medida que se trabaja en el proyecto. Cuando el tiempo llegue a 0, se bloqueará VSCode para ese proyecto, forzando al usuario a cambiar de proyecto o a cerrar VSCode. Tras un tiempo de cooldown, el tiempo de trabajo se reiniciará, y el usuario podrá volver a trabajar en el proyecto por un tiempo.

# Funcionamiento

## Página de Configuración

En la página de configuración, el usuario tendrá una tabla a la que podrá añadir entradas que consistan en:

- Nombre del proyecto a limitar
- Tiempo de trabajo (seguido)
- Tiempo de cooldown

Una entrada no podrá ser modificada si el proyecto se encuentra bloqueado. El usuario deberá esperar a que pase el tiempo de Cooldown.

## Ejecución

Cuando se abra una carpeta con VSCode, Restraint™ mirará el nombre de la carpeta. Si ese nombre está en su tabla, comenzará a funcionar. De lo contrario, se mantendrá inactivo.

Mientras VSCode este abierto en la carpeta de un proyecto a limitar (de ahora en adelante, "el proyecto"), Restraint™ mostrará en la barra inferior un temporizador con el tiempo restante para ese proyecto, que irá bajando cada segundo.

Cuando el contador llegue a 0, se impedirá que el usuario siga trabajando en el proyecto. Esto se puede lograr de diversas maneras, como, por ejemplo, mostrando una notificación persistente, o abriendo automáticamente una pestaña en VSCode con un mensaje, y haciendo que se reabra si el usuario la cierra.

A su vez, cuando el contador llegue a 0, se pondrá un segundo contador: el contador de cooldown. Este no se muestra al usuario, y debe contar aun cuando el usuario esté en otra ventana o con el VSCode cerrado, así que es mejor implementarlo como una "hora de desbloqueo".

Cuando llegue dicha hora de desbloqueo, el tiempo de uso se reiniciará y el usuario podrá volver a abrir el proyecto limitado, y trabajar en él durante el tiempo de uso.