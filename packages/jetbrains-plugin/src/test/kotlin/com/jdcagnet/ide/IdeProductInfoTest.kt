package com.jdcagnet.ide

import kotlin.test.Test
import kotlin.test.assertEquals

class IdeProductInfoTest {
    @Test
    fun `normalizes JetBrains product names into stable ids`() {
        assertEquals("intellij-idea", ideIdForName("IntelliJ IDEA"))
        assertEquals("webstorm", ideIdForName("WebStorm"))
        assertEquals("pycharm", ideIdForName("PyCharm"))
        assertEquals("android-studio", ideIdForName("Android Studio"))
    }

    @Test
    fun `falls back when product name has no usable ascii characters`() {
        assertEquals("jetbrains-ide", ideIdForName("  ---  "))
    }
}
