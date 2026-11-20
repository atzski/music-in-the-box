// Pas de console derrière l'app en version publiée.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    music_in_the_box_lib::run()
}
