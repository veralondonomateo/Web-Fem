#!/bin/zsh
# Carga .env.local y ejecuta el comando con esas variables.
#
# Respeta las comillas y descarta los comentarios en línea. Sin esto último,
# `CLAVE=""   # pendiente` acababa exportando el comentario como valor, y los
# scripts fallaban con un mensaje que no decía nada.
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line#"${line%%[![:space:]]*}"}"          # recorta espacios de la izquierda
  case "$line" in ''|'#'*) continue;; esac
  [[ "$line" == *=* ]] || continue

  key="${${line%%=*}#export }"
  key="${key//[[:space:]]/}"

  val="${line#*=}"
  val="${val#"${val%%[![:space:]]*}"}"
  case "$val" in
    \"*) val="${val#\"}"; val="${val%%\"*}" ;;     # "valor"  → hasta la comilla de cierre
    \'*) val="${val#\'}"; val="${val%%\'*}" ;;     # 'valor'  → ídem
    *)   val="${val%%\#*}"                         # sin comillas → corta el comentario
         val="${val%"${val##*[![:space:]]}"}" ;;   # y los espacios que queden
  esac

  export "$key=$val"
done < .env.local
exec "$@"
