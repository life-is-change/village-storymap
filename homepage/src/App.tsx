import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { 
  MapPin, 
  BookOpen, 
  AlertTriangle, 
  Compass, 
  ArrowRight,
  ArrowUp,
  User,
  UserPlus,
  LogOut,
  Menu,
  X,
  Trees,
  Home,
  GraduationCap,
  Map,
  Leaf
} from 'lucide-react';

function App() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showBackTop, setShowBackTop] = useState(false);
  const [authState, setAuthState] = useState<{ isLoggedIn: boolean; displayName: string; username: string }>({
    isLoggedIn: false,
    displayName: '',
    username: ''
  });

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'village-auth-state') {
        setAuthState({
          isLoggedIn: event.data.payload?.isLoggedIn || false,
          displayName: event.data.payload?.name || '',
          username: event.data.payload?.studentId || ''
        });
      }
    };
    window.addEventListener('message', handleMessage);
    // 请求父页面发送当前登录状态
    window.parent.postMessage({ type: 'village-auth-request' }, '*');
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const requestAuth = useCallback((mode: 'login' | 'register' = 'login') => {
    window.parent.postMessage({ type: 'village-auth-request', mode }, '*');
  }, []);

  const requestLogout = useCallback(() => {
    window.parent.postMessage({ type: 'village-auth-logout' }, '*');
    setAuthState({
      isLoggedIn: false,
      displayName: '',
      username: ''
    });
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
      setShowBackTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-gradient-nature">
      {/* Navigation */}
      <nav 
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled 
            ? 'glass shadow-lg py-3' 
            : 'bg-transparent py-5'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-emerald-500 rounded-xl flex items-center justify-center shadow-lg">
                <Trees className="w-6 h-6 text-white" />
              </div>
              <span className={`text-xl font-bold transition-colors ${
                isScrolled ? 'text-gray-800' : 'text-white'
              }`}>
                村庄规划互动平台
              </span>
            </div>

            {/* Desktop Navigation */}
            <div className="home-nav-list hidden md:flex items-center justify-center gap-8">
              <button 
                onClick={() => scrollToSection('village-status')}
                className={`home-nav-link text-sm font-medium transition-colors hover:opacity-80 ${
                  isScrolled ? 'text-gray-700' : 'text-white/90'
                }`}
              >
                村庄现状
              </button>
              <button 
                onClick={() => scrollToSection('teaching-purpose')}
                className={`home-nav-link text-sm font-medium transition-colors hover:opacity-80 ${
                  isScrolled ? 'text-gray-700' : 'text-white/90'
                }`}
              >
                教学目的
              </button>
              <button 
                onClick={() => scrollToSection('current-issues')}
                className={`home-nav-link text-sm font-medium transition-colors hover:opacity-80 ${
                  isScrolled ? 'text-gray-700' : 'text-white/90'
                }`}
              >
                现状问题
              </button>
              <button 
                onClick={() => scrollToSection('location-environment')}
                className={`home-nav-link text-sm font-medium transition-colors hover:opacity-80 ${
                  isScrolled ? 'text-gray-700' : 'text-white/90'
                }`}
              >
                区位与环境
              </button>
            </div>

            {/* Auth Buttons */}
            <div className="hidden md:flex items-center gap-3">
              {authState.isLoggedIn ? (
                <>
                  <div className={`home-auth-pill flex items-center gap-2 px-3 py-1.5 rounded-full ${isScrolled ? 'home-auth-pill-scrolled' : 'home-auth-pill-hero'}`}>
                    <User className="w-4 h-4" />
                    <span className="text-sm font-medium">你好，{authState.displayName || authState.username}</span>
                  </div>
                  <Button
                    type="button"
                    data-home-logout-btn="1"
                    variant="ghost"
                    className={`home-logout-btn gap-2 rounded-full px-3 py-1.5 ${isScrolled ? 'home-logout-btn-scrolled' : 'home-logout-btn-hero'}`}
                    onClick={requestLogout}
                  >
                    <LogOut className="w-4 h-4" />
                    退出登录
                  </Button>
                </>
              ) : (
                <>
                  <Button 
                    variant="ghost" 
                    className={`gap-2 ${isScrolled ? 'text-gray-700 hover:text-gray-900' : 'text-white hover:text-white hover:bg-white/20'}`}
                    onClick={() => requestAuth('login')}
                  >
                    <User className="w-4 h-4" />
                    登录
                  </Button>
                  <Button 
                    className="gap-2 bg-white text-green-700 hover:bg-gray-100 shadow-md"
                    onClick={() => requestAuth('register')}
                  >
                    <UserPlus className="w-4 h-4" />
                    注册
                  </Button>
                </>
              )}
            </div>

            {/* Mobile Menu Button */}
            <button 
              className="md:hidden p-2"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? (
                <X className={`w-6 h-6 ${isScrolled ? 'text-gray-800' : 'text-white'}`} />
              ) : (
                <Menu className={`w-6 h-6 ${isScrolled ? 'text-gray-800' : 'text-white'}`} />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden glass mt-3 mx-4 rounded-2xl shadow-xl p-4 animate-slide-up">
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => scrollToSection('village-status')}
                className="text-left px-4 py-3 rounded-xl hover:bg-green-50 text-gray-700 font-medium transition-colors"
              >
                村庄现状
              </button>
              <button 
                onClick={() => scrollToSection('teaching-purpose')}
                className="text-left px-4 py-3 rounded-xl hover:bg-green-50 text-gray-700 font-medium transition-colors"
              >
                教学目的
              </button>
              <button 
                onClick={() => scrollToSection('current-issues')}
                className="text-left px-4 py-3 rounded-xl hover:bg-green-50 text-gray-700 font-medium transition-colors"
              >
                现状问题
              </button>
              <button 
                onClick={() => scrollToSection('location-environment')}
                className="text-left px-4 py-3 rounded-xl hover:bg-green-50 text-gray-700 font-medium transition-colors"
              >
                区位与环境
              </button>
              <hr className="my-2" />
              {authState.isLoggedIn ? (
                <>
                  <div className="flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-green-50 text-green-700">
                    <User className="w-4 h-4" />
                    <span className="text-sm font-medium">你好，{authState.displayName || authState.username}</span>
                  </div>
                  <Button variant="outline" data-home-logout-btn="1" className="w-full gap-2 justify-center" onClick={requestLogout}>
                    <LogOut className="w-4 h-4" />
                    退出登录
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" className="w-full gap-2 justify-center" onClick={() => requestAuth('login')}>
                    <User className="w-4 h-4" />
                    登录
                  </Button>
                  <Button className="w-full gap-2 justify-center bg-green-600 hover:bg-green-700" onClick={() => requestAuth('register')}>
                    <UserPlus className="w-4 h-4" />
                    注册
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-gradient-hero">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-20 left-10 w-72 h-72 bg-white rounded-full blur-3xl" />
            <div className="absolute bottom-20 right-10 w-96 h-96 bg-emerald-300 rounded-full blur-3xl" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-green-400 rounded-full blur-3xl opacity-30" />
          </div>
          {/* Grid Pattern */}
          <div 
            className="absolute inset-0 opacity-5"
            style={{
              backgroundImage: `linear-gradient(rgba(255,255,255,.3) 1px, transparent 1px),
                               linear-gradient(90deg, rgba(255,255,255,.3) 1px, transparent 1px)`,
              backgroundSize: '50px 50px'
            }}
          />
        </div>

        {/* Hero Content */}
        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center pt-20">
          <div className="animate-fade-in">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 mb-8">
              <Leaf className="w-4 h-4 text-emerald-300" />
              <span className="text-white/90 text-sm font-medium">智慧乡村 · 数字规划</span>
            </div>

            {/* Main Title */}
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight">
              村庄规划
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-emerald-200 to-green-100">
                互动平台
              </span>
            </h1>

            {/* Subtitle */}
            <p className="text-lg sm:text-xl text-white/80 max-w-2xl mx-auto mb-10 leading-relaxed">
              运用数字化技术，打造沉浸式村庄规划体验。
              <br className="hidden sm:block" />
              让规划更直观，让参与更便捷，让乡村更美好。
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button 
                size="lg"
                className="home-hero-action-btn home-hero-primary-btn w-full sm:w-auto gap-3 text-lg px-8 py-6 rounded-xl font-semibold"
              >
                进入互动平台
                <ArrowRight className="w-5 h-5" />
              </Button>
              <Button 
                size="lg"
                className="home-hero-action-btn home-hero-secondary-btn home-hero-secondary-compact w-full sm:w-auto gap-3 text-lg px-8 py-6 rounded-xl font-semibold"
                onClick={() => scrollToSection('village-status')}
              >
                了解更多
                <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
            {[
              { label: '规划村庄', value: '50+' },
              { label: '参与用户', value: '1000+' },
              { label: '规划方案', value: '200+' },
              { label: '覆盖面积', value: '5000亩' },
            ].map((stat, index) => (
              <div 
                key={index} 
                className="text-center p-4 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10"
              >
                <div className="text-2xl sm:text-3xl font-bold text-white mb-1">{stat.value}</div>
                <div className="text-white/60 text-sm">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Scroll Indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="w-8 h-12 rounded-full border-2 border-white/30 flex items-start justify-center p-2">
            <div className="w-1.5 h-3 bg-white/60 rounded-full" />
          </div>
        </div>
      </section>

      {/* Village Status Section */}
      <section id="village-status" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-100 text-green-700 mb-6">
              <Home className="w-4 h-4" />
              <span className="text-sm font-medium">村庄现状</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-800 mb-4">
              了解村庄当前发展状况
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              全面展示村庄的人口、经济、基础设施等基本情况，为规划提供数据支撑
            </p>
          </div>

          {/* Placeholder Cards */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { title: '人口概况', desc: '村庄人口数量、年龄结构、劳动力分布等数据' },
              { title: '经济发展', desc: '主要产业、收入水平、就业情况等经济指标' },
              { title: '基础设施', desc: '道路、水电、通信等基础设施建设情况' },
            ].map((item, index) => (
              <div 
                key={index}
                className="group p-8 rounded-3xl bg-white/70 backdrop-blur-sm border border-green-100 hover:bg-white hover:shadow-xl transition-all duration-300 cursor-pointer"
              >
                <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center mb-6 group-hover:bg-green-600 transition-colors">
                  <MapPin className="w-7 h-7 text-green-600 group-hover:text-white transition-colors" />
                </div>
                <h3 className="text-xl font-semibold text-gray-800 mb-3">{item.title}</h3>
                <p className="text-gray-600">{item.desc}</p>
                <div className="mt-6 flex items-center text-green-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  <span>查看详情</span>
                  <ArrowRight className="w-4 h-4 ml-2" />
                </div>
              </div>
            ))}
          </div>

          {/* Content Placeholder */}
          <div className="mt-12 p-12 rounded-3xl bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-dashed border-green-200 text-center">
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
              <Home className="w-10 h-10 text-green-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">村庄现状内容区域</h3>
            <p className="text-gray-500 max-w-md mx-auto">
              此处预留村庄现状的详细内容展示区域，可放置数据图表、图片、文字介绍等内容
            </p>
          </div>
        </div>
      </section>

      {/* Teaching Purpose Section */}
      <section id="teaching-purpose" className="py-24 px-4 sm:px-6 lg:px-8 bg-white/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-100 text-blue-700 mb-6">
              <GraduationCap className="w-4 h-4" />
              <span className="text-sm font-medium">教学目的</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-800 mb-4">
              培养规划思维与实践能力
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              通过互动式学习，让学生掌握村庄规划的基本方法和技能
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: BookOpen, title: '理论学习', desc: '村庄规划基础知识' },
              { icon: Map, title: '案例分析', desc: '典型村庄规划案例' },
              { icon: Compass, title: '实践操作', desc: '动手设计规划方案' },
              { icon: Trees, title: '创新思维', desc: '培养创新规划理念' },
            ].map((item, index) => (
              <div 
                key={index}
                className="text-center p-6 rounded-2xl hover:bg-white hover:shadow-lg transition-all duration-300"
              >
                <div className="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto mb-4">
                  <item.icon className="w-8 h-8 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">{item.title}</h3>
                <p className="text-gray-600 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Content Placeholder */}
          <div className="mt-12 p-12 rounded-3xl bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-dashed border-blue-200 text-center">
            <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-6">
              <GraduationCap className="w-10 h-10 text-blue-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">教学目的内容区域</h3>
            <p className="text-gray-500 max-w-md mx-auto">
              此处预留教学目的的详细内容展示区域，可放置教学目标、课程大纲、学习路径等内容
            </p>
          </div>
        </div>
      </section>

      {/* Current Issues Section */}
      <section id="current-issues" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 text-amber-700 mb-6">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm font-medium">现状问题</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-800 mb-4">
              识别发展中的挑战与机遇
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              深入分析村庄发展中面临的问题，为制定解决方案提供依据
            </p>
          </div>

          {/* Issues List */}
          <div className="grid md:grid-cols-2 gap-6">
            {[
              { title: '人口流失', desc: '青壮年劳动力外出务工，村庄空心化问题' },
              { title: '产业单一', desc: '经济结构单一，缺乏多元化发展' },
              { title: '设施老化', desc: '部分基础设施年久失修，需要更新改造' },
              { title: '环境压力', desc: '生态环境保护与发展的平衡问题' },
            ].map((item, index) => (
              <div 
                key={index}
                className="flex items-start gap-4 p-6 rounded-2xl bg-white/70 backdrop-blur-sm border border-amber-100 hover:shadow-lg transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-6 h-6 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">{item.title}</h3>
                  <p className="text-gray-600">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Content Placeholder */}
          <div className="mt-12 p-12 rounded-3xl bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-dashed border-amber-200 text-center">
            <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-10 h-10 text-amber-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">现状问题内容区域</h3>
            <p className="text-gray-500 max-w-md mx-auto">
              此处预留现状问题的详细内容展示区域，可放置问题分析、数据报告、调研结果等内容
            </p>
          </div>
        </div>
      </section>

      {/* Location & Environment Section */}
      <section id="location-environment" className="py-24 px-4 sm:px-6 lg:px-8 bg-white/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-100 text-cyan-700 mb-6">
              <Compass className="w-4 h-4" />
              <span className="text-sm font-medium">区位与环境</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-800 mb-4">
              探索地理优势与生态资源
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              全面了解村庄的地理位置、交通条件和自然环境特征
            </p>
          </div>

          {/* Environment Cards */}
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { title: '地理位置', desc: '区域位置、行政区划、相邻关系' },
              { title: '交通条件', desc: '道路网络、公共交通、出行便利度' },
              { title: '自然资源', desc: '土地、水源、森林、矿产等资源' },
            ].map((item, index) => (
              <div 
                key={index}
                className="p-8 rounded-3xl bg-gradient-to-br from-cyan-50 to-teal-50 border border-cyan-100 hover:shadow-xl transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-cyan-100 flex items-center justify-center mb-6">
                  <Compass className="w-7 h-7 text-cyan-600" />
                </div>
                <h3 className="text-xl font-semibold text-gray-800 mb-3">{item.title}</h3>
                <p className="text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Content Placeholder */}
          <div className="mt-12 p-12 rounded-3xl bg-gradient-to-br from-cyan-50 to-teal-50 border-2 border-dashed border-cyan-200 text-center">
            <div className="w-20 h-20 rounded-full bg-cyan-100 flex items-center justify-center mx-auto mb-6">
              <Map className="w-10 h-10 text-cyan-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">区位与环境内容区域</h3>
            <p className="text-gray-500 max-w-md mx-auto">
              此处预留区位与环境的详细内容展示区域，可放置地图、环境照片、区位分析等内容
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-hero p-12 sm:p-16 text-center">
            {/* Background Decoration */}
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-0 left-0 w-64 h-64 bg-white rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
              <div className="absolute bottom-0 right-0 w-64 h-64 bg-emerald-300 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
            </div>

            <div className="relative z-10">
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                准备好开始规划了吗？
              </h2>
              <p className="text-white/80 text-lg mb-8 max-w-xl mx-auto">
                加入我们的互动平台，开启您的村庄规划之旅，共同打造美好乡村
              </p>
              <Button 
                size="lg"
                className="gap-3 bg-white text-green-700 hover:bg-gray-100 shadow-xl text-lg px-10 py-6 rounded-xl font-semibold"
              >
                立即进入平台
                <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Back to Top */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className={`fixed bottom-8 right-8 z-50 w-12 h-12 rounded-full bg-white/90 backdrop-blur-sm border border-green-200 text-green-700 shadow-lg flex items-center justify-center transition-all duration-300 hover:bg-white hover:shadow-xl hover:-translate-y-1 ${showBackTop ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}
        aria-label="回到顶部"
      >
        <ArrowUp className="w-5 h-5" />
      </button>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-400 rounded-xl flex items-center justify-center">
                  <Trees className="w-6 h-6 text-white" />
                </div>
                <span className="text-xl font-bold">村庄规划互动平台</span>
              </div>
              <p className="text-gray-400 max-w-sm">
                致力于通过数字化技术，推动村庄规划的科学化、民主化、可视化发展
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">快速链接</h4>
              <ul className="space-y-2 text-gray-400">
                <li><button onClick={() => scrollToSection('village-status')} className="hover:text-white transition-colors">村庄现状</button></li>
                <li><button onClick={() => scrollToSection('teaching-purpose')} className="hover:text-white transition-colors">教学目的</button></li>
                <li><button onClick={() => scrollToSection('current-issues')} className="hover:text-white transition-colors">现状问题</button></li>
                <li><button onClick={() => scrollToSection('location-environment')} className="hover:text-white transition-colors">区位与环境</button></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">联系我们</h4>
              <ul className="space-y-2 text-gray-400">
                <li>邮箱：contact@village-planning.com</li>
                <li>电话：400-123-4567</li>
                <li>地址：某某省某某市某某区</li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-gray-800 text-center text-gray-500 text-sm">
            © 2024 中国区域协调发展与乡村建设研究院. 保留所有权利.
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
