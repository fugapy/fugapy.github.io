; FUGA - Capas auxiliares para el computo. Comando: FUGACAPAS.
; AutoLISP puro: compatible con AutoCAD Core Console, sin ActiveX.
; No cambia CLAYER, no borra objetos ni modifica la configuracion.
(defun c:FUGACAPAS (/ capas capa nombre color entidad datos limpios par listas resultado)
  (setq capas
    '(("FUGA-CONTORNO" 6)
      ("FUGA-MURO-20" 1)
      ("FUGA-MURO-15" 30)
      ("FUGA-MURALLA" 94)
      ("FUGA-PUERTA" 3)
      ("FUGA-VENTANA" 4)
      ("FUGA-LOCAL" 8)
      ("FUGA-TECHO" 2)
      ("FUGA-DATO" 7)
      ("FUGA-EXCLUIR" 9)))
  (setq listas 0)
  (foreach capa capas
    (setq nombre (car capa) color (cadr capa))
    (if (tblsearch "LAYER" nombre)
      (progn
        (setq entidad (tblobjname "LAYER" nombre)
              datos (entget entidad)
              limpios nil)
        ; Conserva apagado/encendido, congelacion, bloqueo y demas propiedades.
        (if (< (cdr (assoc 62 datos)) 0) (setq color (- color)))
        ; Elimina True Color/Color Book para que mande el color ACI solicitado.
        ; Reemplaza tambien el tipo de linea y la marca de impresion.
        (foreach par datos
          (if (not (member (car par) '(6 62 290 420 430)))
            (setq limpios (cons par limpios))))
        (setq resultado
          (entmod (append (reverse limpios)
            (list (cons 62 color) '(6 . "Continuous") '(290 . 0))))))
      (setq resultado
        (entmake
          (list '(0 . "LAYER")
                '(100 . "AcDbSymbolTableRecord")
                '(100 . "AcDbLayerTableRecord")
                (cons 2 nombre) '(70 . 0) (cons 62 color)
                '(6 . "Continuous") '(290 . 0)))))
    ; Solo informa exito si AutoCAD acepto y guardo las propiedades pedidas.
    (setq datos (if resultado (entget (tblobjname "LAYER" nombre))))
    (if (and datos
             (= (abs (cdr (assoc 62 datos))) (cadr capa))
             (equal (cdr (assoc 290 datos)) 0)
             (equal (strcase (cdr (assoc 6 datos))) "CONTINUOUS")
             (not (assoc 420 datos)) (not (assoc 430 datos)))
      (setq listas (1+ listas))
      (princ (strcat "\nNo se pudo preparar la capa: " nombre))))
  (if (= listas (length capas))
    (princ "\nCapas FUGA listas: 10")
    (princ (strcat "\nCapas FUGA incompletas: " (itoa listas) " de 10. Revisa los avisos.")))
  (princ))
(princ)
